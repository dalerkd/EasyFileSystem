import EasyFileSystem from './EasyFileSystem'

async function PackDir(packPath: string, fileSystemName: string) {
    await new EasyFileSystem(`${fileSystemName}_disk.bin`, `${fileSystemName}_inode.bin`).PackDirctory(
        `${packPath}`
    );
    console.log("数据成功装入文件中");
}


function ExplorerFileSystem(fileSystemName: string) {
    let cl = console.log
    const obj = new EasyFileSystem(`${fileSystemName}_disk.bin`, `${fileSystemName}_inode.bin`)
    obj.ExplorerVirtualFileSystem()
    cl('遍历完毕')
}

async function Test() {
    let fileSystemName = '当前'
    try {
        await PackDir('./', fileSystemName);
    } catch (e) {
        console.log(e)
    }
    ExplorerFileSystem(fileSystemName)
}

EasyFileSystem.TestMySelf();
Test()
