import EasyFileSystem from "./EasyFileSystem";

async function TestPackDir() {
    new EasyFileSystem('disk.bin', 'inode.bin').PackDirctory('F:/Desktop/截图/MyCut/')
    console.log('数据成功装入文件中')
}

EasyFileSystem.TestMySelf()
TestPackDir()