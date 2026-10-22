package kr.bloodnote.app;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Standalone JVM tests; no personal certificate is included in the project. */
public final class CertificateParserTest {
    private static int checks;
    private static String page(int index, int pages, int count, String rows) {
        return "헌혈확인증명서(개인)\nNO. " + index + "/" + pages + "\n헌혈횟수 " + count
            + " 사용용도 조회용\n번호 증서번호 헌혈종류 헌혈일자 헌혈장소\n" + rows;
    }
    private static CertificateParser parse(String... pages) {
        CertificateParser parser = new CertificateParser(pages.length);
        for (int i = 0; i < pages.length; i++) parser.accept(pages[i], i + 1);
        parser.finish(); return parser;
    }
    private static void expect(boolean ok) { checks++; if (!ok) throw new AssertionError("Check " + checks); }
    private static void rejects(Runnable call) {
        checks++;
        try { call.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Must reject: " + checks);
    }
    public static void main(String[] args) throws Exception {
        if (args.length > 0) {
            String source = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
            System.out.println(parse(source.split("\\f")).finishJson()); return;
        }
        String a="1 99-20-000001 혈소판혈장 2020-02-29 테스트센터\n";
        List<CertificateParser.Row> rows=parse(page(1,2,3,a+"2 99-20-000002 혈장 2020-03-14 테스트센터\n"),
            page(2,2,3,"3 99-20-000003 혈소판 2020-04-01 테스트센터\n")).finish();
        expect(rows.size()==3&&rows.get(0).type.equals("mixed")&&rows.get(1).type.equals("plasma"));
        expect(rows.get(2).sourceType.equals("혈소판")&&rows.get(2).type.equals("platelet")&&rows.get(2).page==2);
        expect(parse(page(1,1,1,"1 99 - 20 - 000001\n혈 소 판 혈 장\n2020 - 2 - 29 테스트")).finish().get(0).date.equals("2020-02-29"));
        for(String kind:new String[]{"전혈","전혈400ml","전혈(320mL)","전혈 400"})
            expect(parse(page(1,1,1,"1 99-20-000001 "+kind+" 2020-02-29 테스트")).finish().get(0).type.equals("whole"));
        expect(parse("헌혈확인증명서(개인)\n헌혈횟수 사용용도 조회용\n1/1\n1\nNO.\n번호 증서번호 헌혈종류 헌혈일자 헌혈장소\n"+a).finish().size()==1);
        rejects(()->parse(page(1,1,1,a.replace("2020-02-29","2021-02-29"))));
        rejects(()->parse(page(1,1,2,a)));
        rejects(()->parse(page(1,2,1,a)));
        rejects(()->parse(page(1,1,1,a).replace("헌혈확인증명서(개인)","다른 문서")));
        rejects(()->parse(page(1,1,1,a.replace("혈소판혈장","알수없음"))));
        rejects(()->parse(page(1,1,1,"")));
        rejects(()->parse(page(1,1,2,a+a)));
        rejects(()->new CertificateParser(301));
        rejects(()->parse(new String(new char[CertificateParser.MAX_PAGE_CHARS+1])));
        String json=parse(page(1,1,1,a)).finishJson();
        expect(!json.contains("99-20-000001")&&!json.contains("테스트센터")&&!json.contains("주민등록"));
        System.out.println("PASS: "+checks+" native parser checks (no device PDF API execution).");
    }
}
