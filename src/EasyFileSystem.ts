import fs from 'fs'
import ASSERT from 'assert'

const INVALID_INODE_INDEX = -1

/**
 * 将数字转为32位宽的Buffer
 * eg: 1234=> [0x77,00,00,00]
 */
function Number2Buffer(num: number): Uint32Array {
    let hex: string = num.toString(16)
    if (hex.length % 2 != 0) {
        hex = '0' + hex
    }
    let matchArray = hex.match(/[\da-f]{2}/gi)!.map(function (h) {
        return parseInt(h, 16)
    })
    let typedArray = new Uint32Array(matchArray)
    return typedArray
}

// http://www.onicos.com/staff/iz/amuse/javascript/expert/utf.txt

/* utf.js - UTF-8 <=> UTF-16 convertion
 *
 * Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0
 * LastModified: Dec 25 1999
 * This library is free.  You can redistribute it and/or modify it.
 */

function Utf8ArrayToStr(array: Uint8Array): string {
    var out, i, len, c;
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while (i < len) {
        c = array[i++];
        switch (c >> 4) {
            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                // 0xxxxxxx
                out += String.fromCharCode(c);
                break;
            case 12: case 13:
                // 110x xxxx   10xx xxxx
                char2 = array[i++];
                out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
                break;
            case 14:
                // 1110 xxxx  10xx xxxx  10xx xxxx
                char2 = array[i++];
                char3 = array[i++];
                out += String.fromCharCode(((c & 0x0F) << 12) |
                    ((char2 & 0x3F) << 6) |
                    ((char3 & 0x3F) << 0));
                break;
        }
    }

    return out;
}

function Buffer2Number(buffer: Uint32Array): number {
    let buff = Buffer.from(buffer)
    return parseInt(buff.toString("hex"), 16)
}

interface IF_Inode {
    offset: number,
    length: number,
    zip: boolean,
    time: {
        creationTime: number
        modifiTime: number
        accessTime: number
    }
}

enum InodeType {
    Directory = 0,
    File = 1
}

interface IF_Directory_Item {
    type: InodeType
    inodeIndex: number
    name: string
}
class DirectoryManager {
    constructor(itemArray: Array<IF_Directory_Item> = []) {
        this.m_itemArray = itemArray
    }
    /**
     * 将数据序列化成Buffer 
     */
    toBuffer(): Uint8Array {
        /**
         * item的数量
         */
        let lenBuffer = new ArrayBuffer(4)
        let dvLen = new DataView(lenBuffer)
        dvLen.setInt32(0, this.m_itemArray.length)
        let buffer = new Uint8Array(lenBuffer)

        this.m_itemArray.forEach((item) => {

            let arrBuffer = new ArrayBuffer(4 * 3)
            let dvBuffer = new DataView(arrBuffer);
            dvBuffer.setInt32(0, item.type)
            dvBuffer.setInt32(4, item.inodeIndex)
            let nameBuffer = Buffer.from(item.name)
            dvBuffer.setInt32(8, nameBuffer.length)//有可能是中文等,不能直接item.name.length
            buffer = Buffer.concat([
                buffer,
                new Uint8Array(arrBuffer),
                new Uint8Array(nameBuffer)
            ])
        })
        return buffer
    }
    /**
     *  从Buffer中构造出一组目录项
     */
    LoadFromBuffer(bufferUint8: Uint8Array) {
        if (!bufferUint8.length) {
            return
        }
        //前4个字节是item的数量,我们这里没有解析
        // 
        let buffer: ArrayBuffer = bufferUint8.buffer.slice(bufferUint8.byteOffset, bufferUint8.byteOffset + bufferUint8.byteLength)
        let dvBuffer = new DataView(buffer)
        let itemNumber = dvBuffer.getInt32(0)
        let offset = 4;
        for (let n = 0; n < itemNumber; n++) {
            const type = dvBuffer.getInt32(offset)
            offset += 4;
            const inodeIndex = dvBuffer.getInt32(offset)
            offset += 4;
            const nameLen = dvBuffer.getInt32(offset)
            offset += 4;
            const u8aStr: Uint8Array = new Uint8Array(buffer.slice(offset, offset + nameLen))
            let name: string = Utf8ArrayToStr(u8aStr)
            offset += nameLen;
            this.m_itemArray.push({
                type: type,
                inodeIndex: inodeIndex,
                name: name
            })
        }
    }
    /*
    大小不能修改
    */
    private m_itemArray: Array<IF_Directory_Item>
    get itemArray(): Array<IF_Directory_Item> {
        return this.m_itemArray
    }
    /**
     * @argument {name}: 文件名 或 文件夹名
     * @argument {type}: 文件 还是文件夹
     * @exception: 找不到
     */
    findInode(name: string, type: InodeType): number {
        let find: boolean = false
        let result: number = INVALID_INODE_INDEX
        this.m_itemArray.some(element => {
            if (element.type == type) {
                if (element.name == name) {
                    result = element.inodeIndex
                    find = true
                    return true
                }
            }
            return false
        });
        if (find) {
            return result
        } else {
            throw ('Not Find' + name + 'in Directory')
        }
    }

    /**
     * 节点必须是 
     * name: 要替换节点的名字
     * type: 要替换节点的类型
     * inodeIndex: 替换成成的节点索引
     * 只能替换已经未初始化的节点
     * @exception: 1. 替换已经初始化的节点 2. 找不到节点
     */
    replaceInode(name: string, type: InodeType, inodeIndex: number) {
        let find: boolean = false

        this.m_itemArray.some((element, key, obj) => {
            if (element.type == type) {
                if (element.name == name) {
                    if (element.inodeIndex != INVALID_INODE_INDEX) {
                        throw ('尝试替换已经初始化的节点')
                    }
                    obj[key].inodeIndex = inodeIndex
                    find = true
                    return true
                }
            }
            return false
        });
        if (find) {
            return
        } else {
            throw ('Not Find' + name + 'in Directory')
        }
    }
    hasExistName(name: string): boolean {
        try {
            try {
                this.findInode(name, InodeType.Directory)
            } catch{
                this.findInode(name, InodeType.File)
            }
        } catch{

            return false
        }
        return true
    }

}

/**
 * EasyFileSystem
 * 提供了
 * 本地目录文件<=>密实平坦文件系统
 */

export default class EasyFileSystem {
    constructor(diskFilePath: string, inodeFilePath: string) {
        let buffer: Buffer
        if (!fs.existsSync(diskFilePath)) {
            buffer = Buffer.from('')
        } else {
            buffer = fs.readFileSync(diskFilePath)
        }

        this.m_diskBuffer = new Uint8Array(buffer)
        if (!fs.existsSync(inodeFilePath)) {
            this.m_inodeBuffer = Buffer.from('')
        }
        else {
            this.m_inodeBuffer = fs.readFileSync(inodeFilePath)
        }

        this.m_nodeArray = []

        //仅仅为了不报TS提醒... ...
        this.m_meta_entry = new DirectoryManager()
        this.initMetaEntry()
    }
    private initMetaEntry() {
        let directory = new DirectoryManager()
        let item: IF_Directory_Item = {
            type: InodeType.Directory,
            inodeIndex: INVALID_INODE_INDEX,
            name: '/'
        }
        directory.itemArray.push(
            item
        )
        this.m_meta_entry = directory
    }
    private m_diskBuffer: Uint8Array
    private m_inodeBuffer: Buffer
    private m_nodeArray: Array<IF_Inode>
    private m_meta_entry: DirectoryManager



    /**
     * 将数据压入 Disk  和 Inode
     * @returns 创建的新的inode的索引
     */
    private AppendInodeAndDisk(buffer: Uint8Array): number {
        let length = buffer.length
        let offset = this.m_diskBuffer.length
        this.m_diskBuffer = Buffer.concat([this.m_diskBuffer, buffer])


        let node: IF_Inode = {
            offset: offset,
            length: length,
            zip: false,
            time: {
                creationTime: (new Date()).valueOf(),
                modifiTime: -1,
                accessTime: -1
            }

        }
        this.m_nodeArray.push(node)
        return this.m_nodeArray.length - 1
    }
    /**
     * 修正已经存在的inode指向的目录项
     * 用于修正父目录已经占位的项指向的inode为正确值
     * {fatherInodeIndex} 要修复的项的父目录的inodeIndex
     * {childItemFileName} 要修复的项的名字
     * {childItemFileName} 要修复的项所属类型
     * {childItemIndex} 要修复项的新索引
     */
    private FixDirInode(fatherInodeIndex: number, childItemFileName: string, childItemType: InodeType, childItemIndex: number) {
        if (childItemFileName == '/') {
            this.m_meta_entry.replaceInode(childItemFileName, childItemType, childItemIndex)
            return
        }
        if (fatherInodeIndex == INVALID_INODE_INDEX) {
            throw ('正在修正无效的 inode索引对应的数据')
        }
        if (fatherInodeIndex >= this.m_nodeArray.length) {
            throw (`正在修正的inode索引: ${fatherInodeIndex} 超出了inode数组范围: ${this.m_nodeArray.length}`)
        }
        let node = this.m_nodeArray[fatherInodeIndex]
        let buffer = this.m_diskBuffer.slice(node.offset, node.offset + node.length)
        let dir = new DirectoryManager()
        dir.LoadFromBuffer(buffer)
        dir.replaceInode(childItemFileName, childItemType, childItemIndex)
        let preDiskBuffer = this.m_diskBuffer.slice(0, node.offset)
        let middleDiskBuffer = dir.toBuffer()
        let tailDiskBuffer = this.m_diskBuffer.slice(node.offset + node.length)
        this.m_diskBuffer = Buffer.concat([preDiskBuffer, middleDiskBuffer, tailDiskBuffer])
    }
    /**
     * 因为是RAW系统,必须分别预留是当前层的子项数量
     * 必须传入子目录和子文件的名字
     */
    private CreateDirectory(path: string, childItem: Array<IF_Directory_Item>) {
        let IsRootPath: boolean = false
        let fatherIndex: number = INVALID_INODE_INDEX
        let dirName: string = ""
        if (path == '/') {
            dirName = '/'
            IsRootPath = true
        } else {
            let obj = this.parsePath(path, InodeType.Directory)
            fatherIndex = obj.fatherIndex
            dirName = obj.itemName
        }

        /*开始构建子目录 */
        //我们会自动创建 . 和 .. 两个文件夹 
        let nextInodeIndex = this.m_nodeArray.length
        let arrDirItem: Array<IF_Directory_Item> = []
        arrDirItem.push({ type: InodeType.Directory, inodeIndex: nextInodeIndex, name: '.' })
        if (!IsRootPath)
            arrDirItem.push({ type: InodeType.Directory, inodeIndex: fatherIndex, name: '..' })

        childItem.forEach((item) => {
            item.inodeIndex = INVALID_INODE_INDEX
            arrDirItem.forEach((value) => {
                if (item.name == value.name) {
                    throw ('希望占用的子目录名字:"' + item.name + '" 已经存在')
                }
            })
            arrDirItem.push(item)
        })
        /**
         * - 将自己的数据写入Disk Buffer中.并在inodeArray中记录
         * - 修改已经保存的父
         * 将自己的id写入到父目录的对应子项中做记录  并保存父目录项
         */
        let objDir = new DirectoryManager(arrDirItem)
        let childNodeIndex = this.AppendInodeAndDisk(objDir.toBuffer())
        this.FixDirInode(fatherIndex, dirName, InodeType.Directory, childNodeIndex)
    }

    /**
     * 创建文件同时写文件
     */
    private CreateFile(path: string, buffer: Uint8Array) {
        let obj = this.parsePath(path, InodeType.File)
        let fatherIndex = obj.fatherIndex
        let fileName = obj.itemName

        let childNodeIndex = this.AppendInodeAndDisk(buffer)
        this.FixDirInode(fatherIndex, fileName, InodeType.File, childNodeIndex)

    }
    /**
     * 提取信息
     * @returns 父节点的数据结构 和 要创建的文件名
     */
    private parsePath(path: string, type: InodeType): {
        'itemName': string,
        'fatherIndex': number
    } {
        if (type == InodeType.Directory) {
            this.CheckDirPath(path)
        } else {
            this.CheckFilePath(path)
        }
        let NAME = type == InodeType.Directory ? '目录' : '文件'
        let arrDirName = path.split('/')
        if (type == InodeType.Directory) {
            arrDirName.pop()
        }
        let name: any = arrDirName.pop()
        if (!name) {
            throw (`要创建的${NAME}的名字错误`)
        }
        let fatherDirPath = arrDirName.join('/')
        if (!fatherDirPath) {
            fatherDirPath = '/'
        }
        if (!fatherDirPath.endsWith('/')) {
            fatherDirPath += '/'
        }
        let fatherDirObj = this.DirDirectory(fatherDirPath)
        //要创建的内容必须在父目录已经预留名字
        let arr_dir
        try {
            arr_dir = fatherDirObj.findInode(name, type)
        } catch{
            throw (`要创建的${NAME}${name}未发现在父目录中预留分配 目录项`)
        }
        if (arr_dir != INVALID_INODE_INDEX) {
            throw (`要创建的${NAME}${name}已经在父目录中存在并分配了inode`)
        }


        let fatherIndex = fatherDirObj.findInode('.', InodeType.Directory)
        return {
            'itemName': name,
            'fatherIndex': fatherIndex
        }
    }

    /**
     * @returns 目录表信息表
     * @exception: 不存在
     */
    DirDirectory(path: string): DirectoryManager {
        this.CheckDirPath(path)
        /*
        null / a / b / null
        */
        let arr = path.split('/')
        // 打开 根
        let dir = this.OpenDirectory(this.m_meta_entry, '/')
        for (let i = 1; i < arr.length - 1; i++) {
            dir = this.OpenDirectory(dir, arr[i])
        }
        return dir
    }
    /**
     * @argument:	{dir}	父目录结构
     * @argument:	{dir}	要打开的子目录名字
     * @returns: 目录结构
     * @exception: 不存在
     */
    private OpenDirectory(dir: DirectoryManager, dirName: string): DirectoryManager {
        let inodeIndex = dir.findInode(dirName, InodeType.Directory)
        let dirBuffer = this.GetDataByInode(inodeIndex)
        let childDir = new DirectoryManager()
        childDir.LoadFromBuffer(dirBuffer)
        return childDir
    }
	/*
		检查目录名是否正确
	*/
    private CheckDirPath(path: string) {
        if (!path.length) {
            throw ('dir path length 0')
        }
        if (!path.endsWith('/')) {
            throw ('dir path must end with "/"')
        }
        if (!path.startsWith('/')) {
            throw ('dir path must start with "/"')
        }
    }
	/*
		检查文件名是否正确
	*/
    private CheckFilePath(path: string) {
        if (!path.length) {
            throw ('file path length 0')
        }
        if (path.endsWith('/')) {
            throw ('file path must no end with "/"')
        }
        if (!path.startsWith('/')) {
            throw ('file path must start with "/"')
        }
    }
    ReadFile(path: string): Uint8Array {
        // 拆分出 文件名
        this.CheckFilePath(path)
        let pathArr = path.split('/')
        let fileName: any = pathArr.pop()
        let dirPath = pathArr.join('/')
        if (!dirPath.endsWith('/')) dirPath += '/'
        let dirInfo: DirectoryManager = this.DirDirectory(dirPath)
        let inodeIndex = dirInfo.findInode(fileName, InodeType.File)
        return this.GetDataByInode(inodeIndex)
    }

    /**
     * 把inode中的数据以Buffer的方式返回
     */
    private GetDataByInode(indexByInode: number): Uint8Array {
        if (indexByInode == INVALID_INODE_INDEX) {
            throw ('无效值: 获取数据通过节点索引操作,发现节点索引是一个 INVALID_INODE_INDEX')
        }
        let len = this.m_nodeArray.length
        if (indexByInode >= len) {
            throw (`超范围: 获取数据通过节点索引操作,发现节点索引: ${indexByInode}超过现在索引最大值: ${len - 1}`)
        }
        let node = this.m_nodeArray[indexByInode]
        return this.m_diskBuffer.slice(node.offset, node.length + node.offset)
    }
    /**
     * 
     * 会返回booleam 是否存在目录
     */
    hasExistDirectory(path: string): boolean {
        try {
            this.DirDirectory(path)
            return true
        } catch{
            return false
        }
    }

    PackDirctory(dirPath: string, flatPath: string = '/') {
        //根据文件路径读取文件，返回文件列表
        let path = require('path')
        fs.readdir(dirPath, (err, files) => {
            if (err) {
                console.warn(err)
            } else {
                /**
                 * 进行两步操作:
                 * 1. 对Item列表插入 TODO
                 * 2. 对 文件 和 目录采取不同的行为 TODO
                 */
                /**
                 * 通过组装item 来 先创建目录及预留子目录项
                 */
                let arrItem: Array<IF_Directory_Item> = []
                files.forEach((filename) => {
                    //获取当前文件的绝对路径
                    var filedir = path.join(dirPath, filename);
                    //根据文件路径获取文件信息，返回一个fs.Stats对象
                    fs.stat(filedir, (eror, stats) => {
                        if (eror) {
                            console.warn('获取文件stats失败');
                        } else {
                            var isFile = stats.isFile();//是文件
                            var isDir = stats.isDirectory();//是文件夹
                            if (isFile) {
                                arrItem.push({
                                    type: InodeType.File, inodeIndex: INVALID_INODE_INDEX, name: filename
                                })
                            } else if (isDir) {
                                arrItem.push({
                                    type: InodeType.Directory, inodeIndex: INVALID_INODE_INDEX, name: filename
                                })
                            }
                        }
                    })
                });
                this.CreateDirectory(flatPath, arrItem)

                /**
                 * 创建子文件
                 */
                files.forEach((filename) => {
                    //获取当前文件的绝对路径
                    var filedir = path.join(dirPath, filename);
                    //根据文件路径获取文件信息，返回一个fs.Stats对象
                    fs.stat(filedir, (eror, stats) => {
                        if (eror) {
                            console.warn('获取文件stats失败');
                        } else {
                            var isFile = stats.isFile();//是文件
                            var isDir = stats.isDirectory();//是文件夹
                            if (isFile) {
                                this.CreateFile(flatPath + filename, fs.readFileSync(filedir))
                            } else if (isDir) {
                                this.PackDirctory(filedir, flatPath + filename + '/');//递归，如果是文件夹，就继续遍历该文件夹下面的文件
                            }
                        }
                    })
                });
            }
        });

    }
    static TestMySelf() {
        let efs = new EasyFileSystem('./inode', './HarkDisk')
        const cl = console.log
        //cl('欢迎使用文件打包系统,它可以将目录打包成一个独立的文件,并提供访问接口')
        cl('## 开始EasyFileSystem系统测试:')
        let arr1: Array<IF_Directory_Item> = [
            { type: InodeType.Directory, inodeIndex: INVALID_INODE_INDEX, name: 'd' }
        ]
        efs.CreateDirectory('/', arr1)
        ASSERT(efs.DirDirectory('/').itemArray.length == 2, '根目录下原始文件夹数量错误')
        ASSERT(efs.hasExistDirectory('/') == true, '不存在预期的 根文件夹')
        ASSERT(efs.hasExistDirectory('/./') == true, '不存在预期的.文件夹在根目录下')
        ASSERT(efs.hasExistDirectory('/./d/') == false, '对不存在的d 没有给出不存在的反馈')
        cl('测试 文件夹存在性 相关测试 √')
        let arr7: Array<IF_Directory_Item> = [

            { type: InodeType.File, inodeIndex: INVALID_INODE_INDEX, name: 'f2.txt' },
            { type: InodeType.File, inodeIndex: INVALID_INODE_INDEX, name: 'f3.txt' },
            { type: InodeType.File, inodeIndex: INVALID_INODE_INDEX, name: 'f4.txt' },
            { type: InodeType.File, inodeIndex: INVALID_INODE_INDEX, name: 'f5.txt' },
            { type: InodeType.File, inodeIndex: INVALID_INODE_INDEX, name: 'f六号文档.txt' },
            { type: InodeType.Directory, inodeIndex: INVALID_INODE_INDEX, name: 'd1' },
            { type: InodeType.Directory, inodeIndex: INVALID_INODE_INDEX, name: 'd二文件夹' },
        ]
        efs.CreateDirectory('/./d/', arr7)//拥有7条内容的文件夹
        efs.CreateDirectory('/./d/d1/', [])//空文件夹
        efs.CreateDirectory('/./d/d二文件夹/', [])
        efs.CreateFile('/./d/f六号文档.txt', Buffer.from('1234\n中5678'))
        ASSERT(Utf8ArrayToStr(efs.ReadFile('/./d/f六号文档.txt')) == '1234\n中5678')
        cl('中文文件名及中文读写文件测试    √')
        ASSERT(efs.DirDirectory('/./d/d二文件夹/').itemArray.length == 2)
        try {
            efs.CreateDirectory('/d/d1/', [])
            ASSERT(false, '禁止重复创建文件夹:失效')
        } catch{
            cl('禁止重复创建文件夹  √');
        }
        efs.DirDirectory('/d/')
        efs.CreateFile('/./d/f2.txt', Buffer.from("1234"))
        efs.CreateFile('/./d/f3.txt', Buffer.from("1234"))
        efs.CreateFile('/./d/f4.txt', Buffer.from("1234"))
        efs.CreateFile('/./d/f5.txt', Buffer.from("1234"))
        try {
            efs.CreateFile('/./d/f5.txt', Buffer.from("1234"))
            ASSERT(false, '禁止重复创建文件:失效')
        } catch{
            cl('禁止重复创建文件   √');
        }
        try {
            efs.CreateFile('/./d/f6.txt', Buffer.from("1234"))
            ASSERT(false, '禁止创建超出约定名字的文件')
        } catch{
            cl('禁止创建超出约定名字的文件  √');
        }
        try {
            efs.DirDirectory('/b')
            ASSERT(false)
        } catch{
            cl('文件夹名字规范性检查    √');
        }
        ASSERT(efs.DirDirectory('/d/').itemArray.length == (2/*. 和 .. */ + 7))
        cl('批量创建文件及文件夹数量检查    √')
        cl('全部测试  通过  √')
    }

}

