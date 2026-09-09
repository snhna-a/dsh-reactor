import { execa } from 'execa';
export function interpolate(template, payload) {
    return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path) => {
        let p = path.trim();
        if (p.startsWith('payload.')) p = p.slice('payload.'.length);
        const parts = p.split('.');
        let cur = payload;
        for (const part of parts) { if (cur == null) return ''; cur = cur[part]; }
        return String(cur ?? '');
    });
}
export async function runShellAction(action, payload) {
    const command = interpolate(action.target, payload);
    await execa(command, { shell: true, stdio: 'inherit' });
}
