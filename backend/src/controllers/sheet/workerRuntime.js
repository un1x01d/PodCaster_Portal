export function startImportJobWorkerRuntime({
  state,
  enabled,
  ownerSeed,
  pollMs,
  lockKey,
  tryAdvisoryLock,
  releaseAdvisoryLock,
  processCurrentDb,
  forEachActiveTenantPool,
}) {
  if (!enabled) {
    console.info("[import_worker] disabled via IMPORT_DB_QUEUE_ENABLED=false");
    return;
  }
  if (state.timer) return;
  state.ownerId = ownerSeed();
  state.timer = setInterval(async () => {
    if (state.running) return;
    state.running = true;
    let lockAcquired = false;
    try {
      lockAcquired = await tryAdvisoryLock(lockKey);
      if (!lockAcquired) return;
      await processCurrentDb(state.ownerId);
      await forEachActiveTenantPool(async (tenant) => {
        await processCurrentDb(`${state.ownerId}:${tenant.db_name}`);
      });
    } catch (err) {
      console.error("[import_worker] tick failed:", err?.message || err);
    } finally {
      if (lockAcquired) {
        await releaseAdvisoryLock(lockKey);
      }
      state.running = false;
    }
  }, pollMs);
  if (state.timer.unref) state.timer.unref();
  console.log(`[import_worker] started owner=${state.ownerId} poll_ms=${pollMs}`);
}

export async function stopImportJobWorkerRuntime(state) {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  while (state.running) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  state.ownerId = null;
}

export async function scheduleNextAutosyncWorkerTickRuntime({ state, loadPollMs, runTick }) {
  if (state.stopped) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const delayMs = await loadPollMs();
  if (state.stopped) return;
  state.timer = setTimeout(() => {
    void runTick();
  }, delayMs);
  if (state.timer.unref) state.timer.unref();
}

export async function runAutosyncWorkerTickRuntime({
  state,
  lockKey,
  tryAdvisoryLock,
  releaseAdvisoryLock,
  processCurrentDb,
  forEachActiveTenantPool,
  scheduleNextTick,
}) {
  if (state.stopped) return;
  if (state.running) {
    await scheduleNextTick();
    return;
  }
  state.running = true;
  let lockAcquired = false;
  try {
    lockAcquired = await tryAdvisoryLock(lockKey);
    if (!lockAcquired) return;
    await processCurrentDb(state.ownerId);
    await forEachActiveTenantPool(async (tenant) => {
      await processCurrentDb(`${state.ownerId}:${tenant.db_name}`);
    });
  } catch (err) {
    console.error("[autosync_worker] tick failed:", err?.message || err);
  } finally {
    if (lockAcquired) {
      await releaseAdvisoryLock(lockKey);
    }
    state.running = false;
    await scheduleNextTick();
  }
}

export function startAutosyncWorkerRuntime({ state, ownerSeed, scheduleNextTick }) {
  if (state.timer) return;
  state.stopped = false;
  state.ownerId = ownerSeed();
  void scheduleNextTick();
  console.log(`[autosync_worker] started owner=${state.ownerId} poll_ms=dynamic`);
}

export async function stopAutosyncWorkerRuntime(state) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.stopped = true;
  while (state.running) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  state.ownerId = null;
}
