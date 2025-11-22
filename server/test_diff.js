
import { getOxidizedDiff } from './src/modules/monitor/oxidized-service.js';

async function test() {
    const node = 'INFORR-BVB-JCL-RX';
    // Use the OID I found earlier: 6518954031bcdda675d05f73a176221d6cd3f9b5
    // I need two OIDs. If I only have one, I can diff against itself (should be empty).
    const oid1 = '6518954031bcdda675d05f73a176221d6cd3f9b5';
    const oid2 = '6518954031bcdda675d05f73a176221d6cd3f9b5';

    console.log(`Testing diff for ${node} between ${oid1} and ${oid2}`);
    const result = await getOxidizedDiff(node, oid1, oid2);
    console.log('Result:', result);
}

test();
