
import { Client as SshClient } from 'ssh2';
import { decryptSecret } from '../../cred.js';

/**
 * Checks SSH connectivity for a device.
 * @param {object} device - The device object from Prisma.
 * @returns {Promise<{ok: boolean, status: string, error?: string}>}
 */
export function checkDeviceSsh(device) {
    return new Promise((resolve) => {
        if (!device.credUsername || !device.credPasswordEnc) {
            return resolve({ ok: false, status: 'auth_error', error: 'Missing credentials' });
        }

        const password = decryptSecret(device.credPasswordEnc);
        if (!password) {
            return resolve({ ok: false, status: 'auth_error', error: 'Failed to decrypt password' });
        }

        const conn = new SshClient();
        let resolved = false;

        const done = (result) => {
            if (!resolved) {
                resolved = true;
                conn.end();
                resolve(result);
            }
        };

        conn.on('ready', () => {
            done({ ok: true, status: 'ok' });
        });

        conn.on('error', (err) => {
            const msg = err.message || String(err);
            let status = 'error';
            if (msg.includes('authentication')) status = 'auth_error';
            if (msg.includes('timed out')) status = 'timeout';
            done({ ok: false, status, error: msg });
        });

        try {
            conn.connect({
                host: device.ipAddress,
                port: device.sshPort || 22,
                username: device.credUsername,
                password: password,
                readyTimeout: 10000, // 10s timeout
                keepaliveInterval: 0,
                algorithms: {
                    kex: [
                        'diffie-hellman-group1-sha1',
                        'diffie-hellman-group14-sha1',
                        'ecdh-sha2-nistp256',
                        'ecdh-sha2-nistp384',
                        'ecdh-sha2-nistp521',
                        'diffie-hellman-group-exchange-sha256',
                        'diffie-hellman-group14-sha256'
                    ],
                    cipher: [
                        'aes128-ctr',
                        'aes192-ctr',
                        'aes256-ctr',
                        'aes128-cbc',
                        '3des-cbc',
                        'aes192-cbc',
                        'aes256-cbc'
                    ],
                    serverHostKey: [
                        'ssh-rsa',
                        'ssh-dss',
                        'ecdsa-sha2-nistp256',
                        'ecdsa-sha2-nistp384',
                        'ecdsa-sha2-nistp521'
                    ]
                }
            });
        } catch (e) {
            done({ ok: false, status: 'error', error: e.message });
        }
    });
}
