import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// SQLite tuning:
// - WAL lets the tracker's writes (/api/collect) overlap with panel reads
//   instead of locking the whole file. journal_mode is persistent in the DB
//   file, so it survives restarts.
// - synchronous=NORMAL keeps fsyncs cheap while staying crash-safe under WAL.
// - busy_timeout queues contending queries instead of failing with SQLITE_BUSY.
// D-137: the pool is 4 (?connection_limit=4 in DATABASE_URL) so parallel
// dashboard reads stop serializing on one connection. The two per-connection
// pragmas are blasted concurrently at startup so every pooled connection gets
// them (journal_mode persists in the file regardless). Residual micro-risk: a
// connection that somehow missed busy_timeout fails a colliding write fast
// instead of waiting — at single-digit writes/sec this is ~never observed.
const PRAGMA_POOL_SIZE = 4 // must match ?connection_limit= in DATABASE_URL
let pragmasApplied = false
async function initPragmas() {
  if (pragmasApplied) return
  pragmasApplied = true
  try {
    await Promise.all(
      Array.from({ length: PRAGMA_POOL_SIZE }, async () => {
        await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
        await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL;')
        await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
      }),
    )
  } catch {
    // best-effort: the DB also works with default settings
    pragmasApplied = false
  }
}
void initPragmas()
