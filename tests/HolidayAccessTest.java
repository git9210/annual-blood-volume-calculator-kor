package kr.bloodnote.app;

public final class HolidayAccessTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        HolidayAccess access = new HolidayAccess();
        check(!access.consume(100), "No internet permission before approval");
        access.approve("first", 100);
        check(access.consume(101), "First approved request allowed");
        check(!access.consume(102), "Same approval cannot be reused");
        access.approve("cancelled", 200);
        access.clear();
        check(!access.consume(201), "Pause/cancel clears permission");
        access.approve("expired", 300);
        check(!access.consume(15_300), "Delayed request cannot use expired approval");
        access.approve("finished", 400);
        access.finish("finished");
        check(!access.consume(401), "Finished refresh leaves no permission");
        access.approve("new", 500);
        access.finish("old");
        check(access.consume(501), "Stale completion cannot cancel a new approval");
        check(!access.consume(502), "New permission is also one use");
        System.out.println("PASS: 8 one-time approval, expiry, cancellation and stale-completion checks.");
    }
}
