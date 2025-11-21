import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

async function clearFailedJobs() {
    const queues = [
        { name: 'snmp-discovery', queue: new Queue('snmp-discovery', { connection: redisConnection }) },
        { name: 'checkmk-sync', queue: new Queue('checkmk-sync', { connection: redisConnection }) },
    ];

    console.log('🧹 Limpando jobs falhados das filas...\n');

    for (const { name, queue } of queues) {
        try {
            const failed = await queue.getFailed();
            console.log(`📋 Fila "${name}": ${failed.length} jobs falhados`);

            for (const job of failed) {
                await job.remove();
            }

            console.log(`✅ Fila "${name}" limpa\n`);
        } catch (error) {
            console.error(`❌ Erro ao limpar fila "${name}":`, error.message);
        }
    }

    console.log('✨ Limpeza concluída!');
    await redisConnection.quit();
    process.exit(0);
}

clearFailedJobs().catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});
