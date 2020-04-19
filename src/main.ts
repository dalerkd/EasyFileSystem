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


function Export(fileSystemName: string, export_root_dir: string) {
    let cl = console.log
    const obj = new EasyFileSystem(`${fileSystemName}_disk.bin`, `${fileSystemName}_inode.bin`)
    obj.Export(export_root_dir)
    cl('导出完毕')
}


async function Test() {
    let fileSystemName = '../当前'
    try {
        await PackDir('../', fileSystemName);
    } catch (e) {
        console.log(e)
    }
    ExplorerFileSystem(fileSystemName)
    Export(fileSystemName, '../../fs_output/')
}

EasyFileSystem.TestMySelf();
Test()
