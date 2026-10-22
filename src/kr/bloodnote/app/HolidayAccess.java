package kr.bloodnote.app;

/** One request per explicit approval, using a monotonic clock and no background timer. */
final class HolidayAccess {
    private static final long START_WINDOW_MS = 15_000;
    private String requestId;
    private long expiresAt;

    synchronized void approve(String id, long now) {
        requestId = id;
        expiresAt = now + START_WINDOW_MS;
    }

    synchronized boolean consume(long now) {
        if (requestId == null || expiresAt == 0 || now >= expiresAt) {
            clear();
            return false;
        }
        expiresAt = 0;
        return true;
    }

    synchronized void finish(String id) {
        if (id != null && id.equals(requestId)) clear();
    }

    synchronized void clear() {
        requestId = null;
        expiresAt = 0;
    }
}
