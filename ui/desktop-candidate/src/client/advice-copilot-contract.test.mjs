import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestionPrompt,suggestionsFromText} from './advice-bridge.ts';
test('Cloud context and DSH persona get three distinct unambiguous bilingual output rows',()=>{
 const prompt=suggestionPrompt({name:'Pietro Falconio',label:'Personal',intro:'对方：Perché non mi rispondi?\n我：Io lavoro e a volte rispondo più tardi.',translation:'为什么不回复我？'});
 assert.match(prompt,/最近真实对话/);assert.match(prompt,/Perché non mi rispondi/);
 assert.doesNotMatch(prompt,/三条方向必须真正不同：温柔自然|严格只输出下列三行/);
 assert.match(prompt,/Yeonhee/);
 assert.match(prompt,/中文译文/);
});
test('model rows expose three independent foreign-language adopt/edit texts with Chinese translations',()=>{
 const answer=[
 '1. 温柔自然：Scusami, oggi ero impegnata. Ti rispondo appena posso. | 中文：抱歉，今天有点忙，有空我就会回复你。',
 '2. 简洁自信：Non sono sempre online, ma mi piace parlare con calma. | 中文：我不是一直在线，但我喜欢从容地聊天。',
 '3. 俏皮轻松：Eccomi! Il telefono non è ancora diventato il mio capo. 😄 | 中文：我来了！手机还没有变成我的老板。😄',
 ].join('\n');
 const rows=suggestionsFromText(answer);
 assert.equal(rows?.length,3);
 assert.deepEqual(rows?.map(x=>x.style),['温柔自然','简洁自信','俏皮轻松']);
 assert.ok(rows?.every(x=>!/[㐀-鿿]/u.test(x.text)&&/[㐀-鿿]/u.test(x.translation)));
 assert.notEqual(rows?.[0]?.text,rows?.[1]?.text);
});
test('reject mixing Chinese into a sendable foreign-language reply',()=>{
 const answer='1. 温柔自然：Ciao 我今天很忙 | 中文：我今天很忙\n2. 简洁自信：Non sono sempre online. | 中文：我不总是在线\n3. 俏皮轻松：Eccomi! | 中文：我来了';
 assert.equal(suggestionsFromText(answer),null);
});
