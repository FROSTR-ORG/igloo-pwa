export class Mutex {
  private mutex = Promise.resolve();
  private timeoutMs: number;

  constructor(timeoutMs = 300000) { // Default 5 minute timeout
    this.timeoutMs = timeoutMs;
  }

  async lock(): Promise<() => void> {
    let resolve: () => void = () => {};
    const newMutex = new Promise<void>((res) => {
      resolve = res;
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Mutex timeout')), this.timeoutMs);
    });

    const oldMutex = this.mutex;
    this.mutex = Promise.race([newMutex, timeoutPromise]);

    await oldMutex;
    return resolve;
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  }
} 