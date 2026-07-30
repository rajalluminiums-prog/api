const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');
const files = ['customers.ts', 'works.ts', 'serviceItems.ts', 'payments.ts', 'documents.ts', 'attachments.ts'];

for (const file of files) {
  const filePath = path.join(routesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. catch block
  content = content.replace(/error\.message \}, 500\)/g, "error.message || 'Internal Server Error' }, 500)");

  // 2. Not found
  content = content.replace(/'Customer not found'/g, "'Not found'");
  content = content.replace(/'Work not found'/g, "'Not found'");
  content = content.replace(/'Service item not found'/g, "'Not found'");
  content = content.replace(/'Payment not found'/g, "'Not found'");
  content = content.replace(/'Document not found'/g, "'Not found'");
  content = content.replace(/'Attachment not found'/g, "'Not found'");

  fs.writeFileSync(filePath, content);
}
console.log('Replacements done');
