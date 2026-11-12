// tsc does not copy the node icons; n8n loads them from next to the compiled node files.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const dir of ['nodes', 'credentials']) {
	const walk = (rel) => {
		for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
			const child = path.join(rel, entry.name);
			if (entry.isDirectory()) walk(child);
			else if (/\.(svg|png)$/.test(entry.name)) {
				fs.mkdirSync(path.join(root, 'dist', rel), { recursive: true });
				fs.copyFileSync(path.join(root, child), path.join(root, 'dist', child));
			}
		}
	};
	walk(dir);
}
