import fs from 'node:fs';
const path='index.html';
let s=fs.readFileSync(path,'utf8');
const css='<link rel="stylesheet" href="./css/phase9b1.css"/>';
const js='<script type="module" src="./js/phase9b1.js"></script>';
if(!s.includes(css)){
  const anchor='<link rel="stylesheet" href="./css/phase9a.css"/>';
  if(!s.includes(anchor))throw new Error('phase9a.css loader not found in index.html');
  s=s.replace(anchor,`${anchor}\n  ${css}`);
}
if(!s.includes(js)){
  const anchor='<script type="module" src="./js/phase9a.js"></script>';
  if(!s.includes(anchor))throw new Error('phase9a.js loader not found in index.html');
  s=s.replace(anchor,`${anchor}\n  ${js}`);
}
fs.writeFileSync(path,s);
console.log('PHASE 9B.1 loaders active.');
