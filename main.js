const { Plugin, Notice, TFile } = require('obsidian');

// Mobile-safe Base64 conversion bypassing Node.js Buffer
function encodeArrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    // Chunking prevents call stack overflows on large images
    for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        for (const byte of chunk) {
            binary += String.fromCharCode(byte);
        }
    }
    return btoa(binary);
}

function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'svg': 'image/svg+xml',
        'avif': 'image/avif'
    };
    return map[ext] || 'image/png';
}

class EmbedImagesIntoNotePlugin extends Plugin {
    async onload() {
        // Triggered by right-clicking a markdown file in the file explorer
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    menu.addItem((item) => {
                        item
                            .setTitle('Save images into Note')
                            .setIcon('image-file')
                            .onClick(async () => {
                                await this.convertImagesInFile(file);
                            });
                    });
                }
            })
        );
    }

    async convertImagesInFile(file) {
        try {
            new Notice('Processing images...');
            let content = await this.app.vault.read(file);
            let modified = false;

            // Matches WikiLinks: ![[image.png]] or ![[image.png|alt text]]
            const wikiRegex = /!\[\[([^\]]+)\]\]/g;
            // Matches Markdown Links: ![alt text](image.png)
            const mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

            const replacements = [];

            // 1. Process WikiLinks
            let wikiMatch;
            while ((wikiMatch = wikiRegex.exec(content)) !== null) {
                const fullMatch = wikiMatch[0];
                const innerContent = wikiMatch[1];
                const parts = innerContent.split('|');
                const linkPath = parts[0];
                const altText = parts[1] || linkPath;

                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
                if (targetFile instanceof TFile && this.isImage(targetFile.extension)) {
                    const base64Link = await this.generateBase64Markdown(targetFile, altText);
                    replacements.push({ from: fullMatch, to: base64Link });
                }
            }

            // 2. Process Markdown Links
            let mdMatch;
            while ((mdMatch = mdRegex.exec(content)) !== null) {
                const fullMatch = mdMatch[0];
                const altText = mdMatch[1];
                const linkPath = mdMatch[2];

                // Skip if it's already a base64 string or an external web link
                if (linkPath.startsWith('data:') || linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
                    continue;
                }

                const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
                if (targetFile instanceof TFile && this.isImage(targetFile.extension)) {
                    const base64Link = await this.generateBase64Markdown(targetFile, altText);
                    replacements.push({ from: fullMatch, to: base64Link });
                }
            }

            if (replacements.length === 0) {
                new Notice('No local image attachments found in this note.');
                return;
            }

            // 3. Apply all string replacements deterministically 
            for (const rep of replacements) {
                content = content.replace(rep.from, rep.to);
                modified = true;
            }

            // 4. Write back to the file system
            if (modified) {
                await this.app.vault.modify(file, content);
                new Notice(`Successfully saved ${replacements.length} image(s) directly into the note.`);
            }
        } catch (error) {
            console.error(error);
            new Notice('Error saving images into note. Check the developer console.');
        }
    }

    isImage(extension) {
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
        return imageExts.includes(extension.toLowerCase());
    }

    async generateBase64Markdown(file, altText) {
        const buffer = await this.app.vault.readBinary(file);
        const base64 = encodeArrayBufferToBase64(buffer);
        const mimeType = getMimeType(file.name);
        return `![${altText}](data:${mimeType};base64,${base64})`;
    }
}

module.exports = EmbedImagesIntoNotePlugin;
