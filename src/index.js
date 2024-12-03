/*
 * @Author: jihongyu3 jihongyu3@tuhu.cn
 * @Date: 2024-09-26 15:47:29
 * @LastEditors: jihongyu3 jihongyu3@tuhu.cn
 * @LastEditTime: 2024-12-03 15:50:10
 * @FilePath: /babel/自动国际化/index.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const { transformFromAstSync } = require('@babel/core');
const  parser = require('@babel/parser');
const autoI18nPlugin = require('./i18n');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');

const root = path.dirname(process.cwd());
const tsxFiles = [];
// 递归遍历目录的函数
function traverseDirectory(dir) {
    const items = fs.readdirSync(dir);

    items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            if(item === 'node_modules' || item === '.git' || item === 'dist' || item == 'output') return
            // 如果是目录，则递归遍历
            traverseDirectory(fullPath);
        } else if (stats.isFile() && path.extname(fullPath) === '.tsx') {
            // 如果是 .tsx 文件，则添加到 tsxFiles 数组中
            tsxFiles.push(path.relative(root, fullPath)); // 使用 path.relative 获取相对于根目录的文件路径
        }
    });
}
traverseDirectory(root);
fse.ensureDirSync(path.resolve(__dirname, './output'));
fse.writeFileSync(path.join(path.resolve(__dirname, './output/zh_CN.js')), 'const resource = {\n');
fse.writeFileSync(path.join(path.resolve(__dirname, './output/en_US.js')), 'const resource = {\n');

tsxFiles.forEach(file => {
    const sourceCode = fs.readFileSync(path.join(root, file), {
        encoding: 'utf-8'
    });
    console.log(path.basename(file), 'jpppppppp')
    
    const ast = parser.parse(sourceCode, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript']
    });
    
    const { code } = transformFromAstSync(ast, sourceCode, {
        plugins: [[autoI18nPlugin, {
            outputDir: path.resolve(__dirname, `./output`),
            sourceFileName: path.basename(file)
        }]]
    });
    fse.writeFileSync(path.join(root, file), code);
    
    console.log(code);
})
fse.appendFile(path.join(path.resolve(__dirname, './output/zh_CN.js')), '};\nexport default resource;');
setTimeout(() => {
    console.log(11111)
    fse.appendFile(path.join(path.resolve(__dirname, './output/en_US.js')), '};\nexport default resource;');
}, 3000)
