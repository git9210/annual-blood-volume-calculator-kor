import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.TreeSet;

/** Host-only build check. Loads the compiled policy without creating an Activity. */
public final class WebAssetPolicyProbe {
    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws Exception {
        Class<?> shell = Class.forName("kr.bloodnote.app.MainActivity");
        Field assets = shell.getDeclaredField("ASSETS");
        assets.setAccessible(true);
        Method mime = shell.getDeclaredMethod("mime", String.class);
        mime.setAccessible(true);
        for (String name : new TreeSet<>((Set<String>) assets.get(null))) {
            System.out.println(name + "\t" + mime.invoke(null, name));
        }
    }
}
