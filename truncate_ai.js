// Run this with: node truncate_ai.js
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'services', 'ai.service.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Find the module.exports closing }; after line 860
let cutAt = -1;
for (let i = 860; i < lines.length; i++) {
  if (lines[i].trim() === '};') {
    cutAt = i;
    break;
  }
}

if (cutAt === -1) {
  console.error('Could not find closing }; after line 860');
  process.exit(1);
}

console.log(`Cutting at line: ${cutAt + 1} (0-indexed: ${cutAt})`);
const clean = lines.slice(0, cutAt + 1).join('\n') + '\n';
fs.writeFileSync(filePath, clean, 'utf8');
console.log(`Done! New line count: ${clean.split('\n').length}`);
