let Queue, Worker;

try {
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  Worker = bullmq.Worker;
} catch (e) {
  console.warn('BullMQ unavailable for notification queue');
}

const { sendNotification } = require('./notification.service');

let notificationQueue = null;

function initNotificationQueue(redisUrl) {
  if (!Queue || !redisUrl) return;

  try {
    const IORedis = require('ioredis');
    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });

    connection.on('ready', () => {
      notificationQueue = new Queue('notifications', { connection });

      const worker = new Worker(
        'notifications',
        async (job) => {
          await sendNotification({ ...job.data, queue: false });
        },
        { connection, concurrency: 5 }
      );

      worker.on('error', (err) => {
        if (err.code !== 'ECONNREFUSED') console.error('Notification worker error:', err.message);
      });

      console.log('Notification queue initialized');
    });

    connection.on('error', () => {});
  } catch (error) {
    console.warn('Notification queue init skipped:', error.message);
  }
}

async function enqueueNotification(payload) {
  if (!notificationQueue) {
    return sendNotification({ ...payload, queue: false });
  }

  const job = await notificationQueue.add('deliver', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });

  return { queued: true, jobId: job.id };
}

module.exports = { initNotificationQueue, enqueueNotification };
