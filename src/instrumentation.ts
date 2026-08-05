export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startEmbeddedBroadcastWorker } = await import(
    './lib/whatsapp/broadcast-worker-scheduler'
  );

  startEmbeddedBroadcastWorker();
}
