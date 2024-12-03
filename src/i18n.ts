const { declare } = require('@babel/helper-plugin-utils');
const fse = require('fs-extra');
const path = require('path');
const generate = require('@babel/generator').default;
const regex = /[\u4e00-\u9fff]/;
const axios = require('axios');
 


// 生成文案唯一的key，正常推荐用中文文案做key
// let intlIndex = 0;
// function nextIntlKey() {
//     ++intlIndex;
//     return `intl${intlIndex}`;
// }

const autoTrackPlugin = declare((api, options, dirname) => {
    api.assertVersion(7);
    let imported;

    // 必须要有输出的文件的地址
    if (!options.outputDir) {
        throw new Error('outputDir in empty');
    }

    // 替换节点：把原本的文本替换为翻译函数的形式
    function getReplaceExpression(path, value, intlUid) {
        const expressionParams = path.isTemplateLiteral() ? path.node.expressions.map(item => generate(item).code) : null
        let replaceExpression = expressionParams 
            ? api.template.ast('`${' + `${intlUid}.t('${value}')` + '}' + '${' + `${expressionParams.join(',')}` + '}`').expression
            : api.template.ast(`${intlUid}.t('${value}')`).expression;
        if (path.findParent(p => p.isJSXAttribute()) && !path.findParent(p=> p.isJSXExpressionContainer())) {
            replaceExpression = api.types.JSXExpressionContainer(replaceExpression);
        }
        return replaceExpression;
    }

    async function translateTextLibreTranslate(text, targetLang) {
        const url = 'https://api.mymemory.translated.net/get';
        const params = {
            q: text,
            langpair: `zh|${targetLang}`, // 源语言为英语，这里假设你要翻译成其他语言
            format: 'text'
        };
    
        try {
            const response = await axios.get(url, { params });
            const responseData = response.data.responseData;
            if (responseData && responseData.translatedText) {
                // console.log(`Translated text: ${responseData.translatedText}`);
                return responseData.translatedText
            } else {
                console.error('No translation found.');
                return '';
            }
        } catch (error) {
            console.error('ERROR:', error);
            return '';
        }
    }

    // 收集key和value保存到file中
    async function save(file, key, value) {
        const allTextCN = file.get('allTextCN');
        const allTextES = file.get('allTextES');
        allTextCN.push({
            key, value
            
        });
        file.set('allTextCN', allTextCN);       
        let v = await translateTextLibreTranslate(value, 'en');
        allTextES.push({
            key, v
            
        });
        file.set('allTextES', allTextES);  
    }

    return {
        // 遍历前执行
        pre(file) {
            file.set('allTextCN', []);
            file.set('allTextES', []);
        },
        visitor: {
            Program: {
                enter(path, state) {
                    // 遍历查看是否引入
                    path.traverse({
                        // 检查有没有引入intl模块
                        ImportDeclaration(p) {
                            const source = p.node.source.value;
                            if(source === 'intl') {
                                imported = true;
                            }
                        }
                    });
                    // console.log(imported)
                    // 没有下载则生成唯一id记录到state中
                    if (!imported) {
                        const uid = path.scope.generateUid('intl');
                        const importAst = api.template.ast(`import ${uid} from 'intl'`);
                        path.node.body.unshift(importAst);
                        state.intlUid = uid;
                    }

                    // 遍历查找需要替换的节点
                    path.traverse({
                        // 对于特定的节点做替换
                        'StringLiteral|TemplateLiteral'(path) {
                            if(path.node.leadingComments) {
                                path.node.leadingComments = path.node.leadingComments.filter((comment, index) => {
                                    // 如果有i18n-disable注释则打上标记，用于之后提取时跳过
                                    if (comment.value.includes('i18n-disable')) {
                                        path.node.skipTransform = true;
                                        return false;
                                    }
                                    return true;
                                })
                            }
                            if(path.findParent(p => p.isImportDeclaration())) {
                                path.node.skipTransform = true;
                            }
                        }
                    });
                }
            },
            // 对于string字面量的替换
            StringLiteral(path, state) {
                if (path.node.skipTransform) {
                    return;
                }
                let key = path.node.value;
                let isChange = false;
                let parentPath = path.parentPath;
                if(
                    parentPath.type === 'CallExpression' &&
                    parentPath.node.callee.type === 'MemberExpression' &&
                    parentPath.node.callee.object.name === '_intl' &&
                    parentPath.node.callee.property.name === 't' &&
                    parentPath.node.arguments[0].value === key  
                ) {
                    isChange = true;
                }
                if(key.match(regex)) {
                    save(state.file, key, path.node.value);
                }
                if(key.match(regex) && !isChange) {
                    // 替换节点
                    const replaceExpression = getReplaceExpression(path, key, state.intlUid);
                    path.replaceWith(replaceExpression);
                    // 跳过新生成节点的处理，不然会陷入死循环
                    path.skip();
                }
            },
            // 对于模版字符串字面量的替换
            TemplateLiteral(path, state) {
                if (path.node.skipTransform) {
                    return;
                }
                const value = path.get('quasis').map(item => item.node.value.raw).join('');
                if(value) {
                    let key = value;
                    let isChange = false;
                    const parentPath = path.parentPath;
                    if(
                        parentPath.type === 'CallExpression' &&
                        parentPath.node.callee.type === 'MemberExpression' &&
                        parentPath.node.callee.object.name === '_intl' &&
                        parentPath.node.callee.property.name === 't' &&
                        parentPath.node.arguments[0].value === key   
                    ) {
                        isChange = true;
                    }
                    if(key.match(regex)) {
                        save(state.file, key, value);
                    }
                    if(key.match(regex) && !isChange) {
                        // 替换节点
                        const replaceExpression = getReplaceExpression(path, key, state.intlUid);
                        path.replaceWith(replaceExpression);
                        path.skip();
                    }
                }
            },
        },
        // 在遍历后执行，主要做的就是把提取的文案存储到对应的文案库中
        post(file) {
            const allTextCN = file.get('allTextCN');
            const intlDataCN = allTextCN.reduce((obj, item) => {
                obj[item.key] = item.value;
                return obj;
            }, {});
            
            // const { stateArg } = arguments
            // console.log(api, options, 'jpppppp')
            const contentCN = `\t${options.sourceFileName.split('.')[0]}: ${JSON.stringify(intlDataCN, null, 8).slice(0, -2)}\n\t},\n`;
            // fse.ensureDirSync(options.outputDir);
            // 文件存在，追加内容到文件末尾
            fse.appendFileSync(path.join(options.outputDir, 'zh_CN.js'), contentCN);
            setTimeout(() => {
                const allTextES = file.get('allTextES');
                const intlDataES = allTextES.reduce((obj, item) => {
                    obj[item.key] = item.v;
                    return obj;
                }, {});
                const contentES = `\t${options.sourceFileName.split('.')[0]}: ${JSON.stringify(intlDataES, null, 8).slice(0, -2)}\n\t},\n`;
                fse.appendFileSync(path.join(options.outputDir, 'en_US.js'), contentES);
            }, 3000)
        }
    }
});
module.exports = autoTrackPlugin;