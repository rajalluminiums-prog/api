const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');
const files = ['customers.ts', 'works.ts', 'serviceItems.ts', 'payments.ts', 'documents.ts', 'attachments.ts'];

for (const file of files) {
  const filePath = path.join(routesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace messages for 400 responses
  content = content.replace(/message: '([^']+)' \}, 400\)/g, (match, p1) => {
    if (!p1.startsWith('Invalid input')) {
      return `message: 'Invalid input: ${p1}' }, 400)`;
    }
    return match;
  });
  
  content = content.replace(/message: `([^`]+)` \}, 400\)/g, (match, p1) => {
    if (!p1.startsWith('Invalid input')) {
      return `message: \`Invalid input: ${p1}\` }, 400)`;
    }
    return match;
  });

  fs.writeFileSync(filePath, content);
}
console.log('400s Replacements done');
