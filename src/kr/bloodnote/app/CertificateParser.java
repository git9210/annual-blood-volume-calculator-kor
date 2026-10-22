package kr.bloodnote.app;

import java.text.Normalizer;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Strict reader for the Red Cross personal donation certificate, not a PDF engine. */
public final class CertificateParser {
    public static final int MAX_PAGES = 300, MAX_ROWS = 3000, MAX_PAGE_CHARS = 100000;
    private static final Pattern PAGE = Pattern.compile("(?<![0-9/])(\\d{1,3})\\s*/\\s*(\\d{1,3})(?![0-9/])");
    private static final Pattern TOTAL = Pattern.compile("헌\\s*혈\\s*횟\\s*수\\s*(\\d{1,4})(?!\\d)");
    private static final Pattern SERIAL = Pattern.compile("(?<![0-9])\\d{2}\\s*-\\s*\\d{2}\\s*-\\s*\\d{6}(?![0-9])");
    private static final Pattern DATE = Pattern.compile("((?:19|20|21)\\d{2})\\s*[-./]\\s*(\\d{1,2})\\s*[-./]\\s*(\\d{1,2})(?![0-9])");
    public static final class Row {
        public final String date, type, sourceType;
        public final int page;
        Row(String date, String type, String sourceType, int page) {
            this.date = date; this.type = type; this.sourceType = sourceType; this.page = page;
        }
    }
    private final int pageCount;
    private int expected = -1, processed;
    private final List<Row> rows = new ArrayList<>();
    // Certificate numbers are transient consistency checks; never returned or stored.
    private final Set<String> certificates = new HashSet<>();
    public CertificateParser(int pageCount) {
        if (pageCount < 1 || pageCount > MAX_PAGES) throw new IllegalArgumentException("1~300쪽의 증명서 PDF를 선택해 주세요.");
        this.pageCount = pageCount;
    }
    public void accept(String source, int pageNumber) {
        if (source == null || source.length() > MAX_PAGE_CHARS) fail(pageNumber, "한 쪽의 내용이 너무 많습니다.");
        if (pageNumber != processed + 1 || pageNumber > pageCount) throw new IllegalArgumentException("PDF 쪽 순서를 확인하지 못했습니다.");
        String text = Normalizer.normalize(source, Normalizer.Form.NFKC)
            .replace('\u00a0', ' ').replace('\u200b', ' ').replace('\u2010', '-').replace('\u2011', '-').replace('\u2013', '-');
        String compact = text.replaceAll("\\s+", "");
        if (!compact.contains("헌혈확인증명서(개인)") || !compact.contains("증서번호")
            || !compact.contains("헌혈종류") || !compact.contains("헌혈일자")) {
            fail(pageNumber, "헌혈확인증명서(개인) 양식의 글자를 읽지 못했습니다. 사진·스캔본은 지원하지 않습니다.");
        }
        Matcher page = PAGE.matcher(text);
        Matcher total = TOTAL.matcher(text);
        if (!page.find() || Integer.parseInt(page.group(1)) != pageNumber || Integer.parseInt(page.group(2)) != pageCount)
            fail(pageNumber, "증명서에 표시된 쪽 번호와 파일의 쪽 수가 다릅니다. 전체 PDF를 선택해 주세요.");
        if (!total.find()) {
            // PDFium may put the page marker between the count label and its value.
            // Keep the search bounded to the header and strip that marker first.
            int table = text.indexOf("헌혈장소");
            String header = table >= 0 ? text.substring(0, table) : text.substring(0, Math.min(600, text.length()));
            header = PAGE.matcher(header).replaceAll("");
            total = Pattern.compile("헌\\s*혈\\s*횟\\s*수[^0-9]{0,80}(\\d{1,4})(?!\\d)").matcher(header);
            if (!total.find()) fail(pageNumber, "헌혈횟수를 읽지 못했습니다.");
        }
        int count = Integer.parseInt(total.group(1));
        if (count < 1 || count > MAX_ROWS || (expected != -1 && expected != count))
            fail(pageNumber, "헌혈횟수가 범위를 벗어나거나 쪽마다 다릅니다.");
        expected = count;
        Matcher serial = SERIAL.matcher(text);
        int found = 0;
        while (serial.find()) {
            if (!certificates.add(serial.group().replaceAll("\\s+", ""))) fail(pageNumber, "증서번호가 중복되어 전체 기록을 확인할 수 없습니다.");
            int end = Math.min(text.length(), serial.end() + 160);
            String tail = text.substring(serial.end(), end);
            Matcher date = DATE.matcher(tail);
            if (!date.find()) fail(pageNumber, "일부 기록의 헌혈일자를 읽지 못했습니다.");
            String rawType = tail.substring(0, date.start()).replaceAll("\\s+", "");
            String type, sourceType;
            if (rawType.equals("혈소판혈장")) { type = "mixed"; sourceType = "혈소판혈장"; }
            else if (rawType.equals("혈소판")) { type = "platelet"; sourceType = "혈소판"; }
            else if (rawType.equals("혈장")) { type = "plasma"; sourceType = "혈장"; }
            else if (rawType.matches("전혈(?:\\(?(?:320|400)(?:[mM][lL]|㎖)?\\)?)?")) { type = "whole"; sourceType = "전혈"; }
            else { fail(pageNumber, "일부 헌혈종류를 읽지 못했습니다. 다른 양식은 직접 입력해 주세요."); return; }
            String iso;
            try {
                iso = LocalDate.of(Integer.parseInt(date.group(1)), Integer.parseInt(date.group(2)), Integer.parseInt(date.group(3))).toString();
            } catch (DateTimeParseException | NumberFormatException error) {
                fail(pageNumber, "유효하지 않은 헌혈일자가 있습니다."); return;
            } catch (java.time.DateTimeException error) {
                fail(pageNumber, "유효하지 않은 헌혈일자가 있습니다."); return;
            }
            rows.add(new Row(iso, type, sourceType, pageNumber));
            found++;
            if (rows.size() > MAX_ROWS) fail(pageNumber, "한 번에 3,000건까지만 읽을 수 있습니다.");
        }
        if (found == 0) fail(pageNumber, "헌혈 내역을 찾지 못했습니다. 누락을 막기 위해 등록하지 않았습니다.");
        processed++;
    }
    public List<Row> finish() {
        if (processed != pageCount || rows.size() != expected)
            throw new IllegalArgumentException("증명서의 " + Math.max(0, expected) + "건 중 " + rows.size() + "건을 읽었습니다. 누락을 막기 위해 등록하지 않았습니다. 원본 전체 PDF를 확인해 주세요.");
        return new ArrayList<>(rows);
    }
    public String finishJson() {
        finish();
        StringBuilder out = new StringBuilder("{\"pages\":" + pageCount + ",\"expected\":" + expected + ",\"rows\":[");
        for (int i = 0; i < rows.size(); i++) {
            Row row = rows.get(i);
            if (i > 0) out.append(',');
            // All strings are validated dates or fixed enums; no source document text is serialized.
            out.append("{\"date\":\"").append(row.date).append("\",\"type\":\"").append(row.type)
                .append("\",\"sourceType\":\"").append(row.sourceType).append("\",\"page\":").append(row.page).append('}');
        }
        return out.append("]}").toString();
    }
    private static void fail(int page, String reason) { throw new IllegalArgumentException(page + "쪽: " + reason); }
}
