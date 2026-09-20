const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { parseSchedule, parseTimetable, parseCalendar, runImportFlow } = require("../../resources/XJNU/xjnu.js");

const semester = "2026-2027-1";
const semesterSelect = value => `<select id="xnxq01id"><option value="${value}" selected>${value}</option></select>`;
const modeSelect = '<select id="kbjcmsid"><option value="mode-test">默认节次模式</option></select>';
const days = ["一", "二", "三", "四", "五", "六", "日"];
const parse = html => new JSDOM(html).window.document;
function block(name = "测试课程甲", schedule = "1-18(周)[01-02-03节]", position = "测试教学楼101") {
    return `${name}<br><font title="教师">测试教师</font><br><font title="周次(节次)">${schedule}</font><br><font title="教室">${position}</font>`;
}
function cell(detail) {
    return `<td><div class="kbcontent1">测试课程甲<br>1-18(周)</div><div class="kbcontent" style="display:none">${detail}</div><div class="kbcontent" style="display:none"></div></td>`;
}
function timetable({ value = semester, detail = block(), duplicate = true, sunday = false, unscheduled = true } = {}) {
    const contentRow = `<tr><th>第1-2节</th>${days.map((_, i) => (sunday ? i === 6 : i === 0) ? cell(detail) : '<td><div class="kbcontent">&nbsp;</div></td>').join("")}</tr>`;
    return `<title>学期理论课表</title>${semesterSelect(value)}${modeSelect}<table id="timetable"><tr><th></th>${days.map(day => `<th>星期${day}</th>`).join("")}</tr>${contentRow}${duplicate ? contentRow : ""}</table>` +
        (unscheduled ? '<table id="dataTables"><tr><th colspan="3">无课表课程</th></tr><tr><th>序号</th><th>课程名称</th><th>授课教师</th></tr><tr><th>1</th><td>测试待排课</td><td>测试教师</td></tr></table>' : "");
}
function calendar(value = semester) {
    return `${semesterSelect(value)}<table id="kbtable"><tr><th></th>${days.map(day => `<th>星期${day}</th>`).join("")}</tr>` +
        '<tr><td>1</td><td title="2026年08月31">31</td></tr><tr><td>20</td><td title="2027年01月11">11</td></tr></table>';
}

test("three-section lessons and explicit odd/even weeks", () => {
    assert.deepEqual(parseSchedule("1-18(单周)[01-02-03节]"), { weeks: [1,3,5,7,9,11,13,15,17], ranges: [{ startSection: 1, endSection: 3 }] });
    assert.deepEqual(parseSchedule("2-8(双周)[05-06节]").weeks, [2,4,6,8]);
    assert.deepEqual(parseSchedule("1,3,5,10-12(周)[07-08-09节]").weeks, [1,3,5,10,11,12]);
    assert.deepEqual(parseSchedule("1-4（周）【01-02节】").weeks, [1,2,3,4]);
});

test("nonconsecutive section lists stay separate; a two-endpoint range expands", () => {
    assert.deepEqual(parseSchedule("1-3(周)[01-03-05节]").ranges, [1,3,5].map(n => ({ startSection: n, endSection: n })));
    assert.deepEqual(parseSchedule("1-3(周)[01-03节]").ranges, [{ startSection: 1, endSection: 3 }]);
});

test("invalid schedules fail instead of silently dropping a lesson", () => {
    for (const bad of ["1-18(周)", "待定(周)[01-02节]", "18-1(周)[01-02节]", "0-2(周)[01节]", "1-2(周)[99节]"]) {
        assert.throws(() => parseSchedule(bad));
    }
});

test("hidden detailed lessons are read once; repeated table cells are deduplicated", () => {
    const result = parseTimetable(parse(timetable()));
    assert.equal(result.courses.length, 1);
    assert.deepEqual(result.courses[0], { name: "测试课程甲", teacher: "测试教师", position: "测试教学楼101", day: 1, startSection: 1, endSection: 3, weeks: Array.from({ length: 18 }, (_, i) => i + 1) });
    assert.deepEqual(result.unscheduled, ["测试待排课"]);
});

test("weekday headers determine Monday and Sunday correctly", () => {
    assert.equal(parseTimetable(parse(timetable({ sunday: true }))).courses[0].day, 7);
    const html = timetable({ sunday: true }).replace("星期日", "星期一").replace("星期一</th><th>星期二", "星期日</th><th>星期二");
    assert.equal(parseTimetable(parse(html)).courses[0].day, 1);
});

test("separated lessons in one cell, HTML course names, and disjoint weeks", () => {
    const detail = block("<font>测试课程甲</font>", "1,3,5(周)[01-02节]") + "<br>---------------------<br>" +
        block("测试课程甲", "2,4,6(周)[01-02节]") + "<br>---------------------<br>" + block("测试课程乙", "1-6(周)[03节]");
    const result = parseTimetable(parse(timetable({ detail })));
    assert.equal(result.courses.length, 2);
    assert.deepEqual(result.courses[0].weeks, [1,2,3,4,5,6]);
    assert.equal(result.courses[1].name, "测试课程乙");
});

test("different rooms are not merged", () => {
    const detail = block("测试课程甲", "1-3(周)[01-02节]", "测试教室甲") + "<br>---------------------<br>" + block("测试课程甲", "4-6(周)[01-02节]", "测试教室乙");
    assert.equal(parseTimetable(parse(timetable({ detail }))).courses.length, 2);
});

test("a scheduled course without a room is preserved with an empty location", () => {
    const detail = block().replace('<font title="教室">测试教学楼101</font>', '');
    const result = parseTimetable(parse(timetable({ detail })));
    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0].position, "");
});

test("login pages and malformed timetable structures are rejected", () => {
    assert.throws(() => parseTimetable(parse('<title>登录</title><input id="userAccount">')), /登录/);
    assert.throws(() => parseTimetable(parse('<title>错误提示页面</title>')), /未找到/);
    assert.throws(() => parseTimetable(parse(timetable().replaceAll('class="kbcontent"', 'class="other"'))), /简略/);
    assert.throws(() => parseTimetable(parse(timetable({ detail: "课程<br>缺少时间" }))), /排课信息/);
});

test("calendar uses the selected semester, actual Monday, and real week count", () => {
    assert.deepEqual(parseCalendar(parse(calendar()), semester), { semesterStartDate: "2026-08-31", semesterTotalWeeks: 20, firstDayOfWeek: 1 });
    assert.throws(() => parseCalendar(parse(calendar("2025-2026-2")), semester), /学期/);
    assert.throws(() => parseCalendar(parse(calendar().replace("2026年08月31", "2026年09月01")), semester), /日期/);
});

function environment({ choose = 0, confirmed = true, saveResult = true, saveThrows = false, calendarFails = false, wrongSemester = false, oldBridge = false } = {}) {
    const dom = new JSDOM("", { url: "https://jwxt.xjnu.edu.cn/jsxsd/framework/xsMain.htmlx" });
    const calls = { requests: [], alerts: [], courses: [], configs: [], completed: 0, times: 0 };
    const env = { location: dom.window.location, DOMParser: dom.window.DOMParser, AbortController, setTimeout, clearTimeout };
    const api = {
        showSingleSelection: async () => choose,
        showAlert: async (...args) => { calls.alerts.push(args); return confirmed; },
        saveImportedCourses: async value => { if (saveThrows) throw new Error("模拟保存失败"); calls.courses.push(JSON.parse(value)); return saveResult; },
        saveCourseConfig: async value => { calls.configs.push(JSON.parse(value)); throw new Error("must not replace config"); },
        savePresetTimeSlots: async () => { calls.times++; throw new Error("must not replace times"); }
    };
    env[oldBridge ? "AndroidBridgePromise" : "shiguangBridgePromise"] = api;
    env[oldBridge ? "AndroidBridge" : "shiguangBridge"] = { notifyTaskCompletion: () => calls.completed++ };
    env.fetch = async (url, options) => {
        calls.requests.push({ url, options });
        if (url.includes("jxzl") && calendarFails) return { ok: false, status: 503 };
        return { ok: true, url, text: async () => url.includes("jxzl") ? calendar() : timetable({ value: options.method && wrongSemester ? "2025-2026-2" : semester }) };
    };
    return { env, calls };
}

test("end-to-end import uses same-origin cookies, clears week filter, and preserves times", async () => {
    const { env, calls } = environment();
    const result = await runImportFlow(env);
    assert.equal(result.status, "imported");
    assert.equal(calls.courses[0].length, 1);
    assert.equal(result.calendar.semesterStartDate, "2026-08-31");
    assert.equal(calls.configs.length, 0);
    assert.equal(calls.times, 0);
    assert.equal(calls.completed, 1);
    assert.match(calls.alerts[0][1], /测试待排课/);
    assert.equal(new URLSearchParams(calls.requests[1].options.body).get("zc"), "");
    assert.ok(calls.requests.every(r => r.options.credentials === "same-origin"));
});

test("legacy Android bridge is supported", async () => {
    const { env, calls } = environment({ oldBridge: true });
    assert.equal((await runImportFlow(env)).status, "imported");
    assert.equal(calls.times, 0);
});

test("cancel selection or confirmation never saves anything", async () => {
    for (const options of [{ choose: null }, { choose: -1 }, { confirmed: false }]) {
        const { env, calls } = environment(options);
        assert.equal((await runImportFlow(env)).status, "cancelled");
        assert.equal(calls.courses.length, 0);
        assert.equal(calls.configs.length, 0);
        assert.equal(calls.completed, 0);
    }
});

test("save failures never announce success or save config", async () => {
    for (const options of [{ saveResult: false }, { saveThrows: true }]) {
        const { env, calls } = environment(options);
        await assert.rejects(runImportFlow(env), /保存/);
        assert.equal(calls.configs.length, 0);
        assert.equal(calls.completed, 0);
        assert.ok(!calls.alerts.some(a => a[0] === "导入完成"));
    }
});

test("calendar failure is disclosed and does not block confirmed course import", async () => {
    const { env, calls } = environment({ calendarFails: true });
    assert.equal((await runImportFlow(env)).status, "imported");
    assert.equal(calls.configs.length, 0);
    assert.match(calls.alerts[0][1], /手动核对开学日期/);
});

test("calendar is shown for manual verification without replacing duration defaults", async () => {
    const { env, calls } = environment();
    const result = await runImportFlow(env);
    assert.equal(calls.courses.length, 1);
    assert.equal(calls.configs.length, 0);
    assert.equal(result.calendar.semesterTotalWeeks, 20);
    assert.match(calls.alerts.at(-1)[1], /2026-08-31/);
});

test("wrong semester or foreign origin cannot import", async () => {
    const { env, calls } = environment({ wrongSemester: true });
    await assert.rejects(runImportFlow(env), /学期/);
    assert.equal(calls.courses.length, 0);
    env.location = { origin: "https://example.com" };
    calls.requests.length = 0;
    await assert.rejects(runImportFlow(env), /先打开/);
    assert.equal(calls.requests.length, 0);
});

test("login expiration on the network response is surfaced", async () => {
    const { env, calls } = environment();
    env.fetch = async () => ({ ok: true, url: "https://jwxt.xjnu.edu.cn/jsxsd/", text: async () => '<title>登录</title><input id="userAccount">' });
    await assert.rejects(runImportFlow(env), /登录/);
    assert.equal(calls.courses.length, 0);
});

test("empty timetables cannot overwrite existing courses", async () => {
    const { env, calls } = environment();
    env.fetch = async url => ({ ok: true, url, text: async () => timetable().replace(/<div class="kbcontent" style="display:none">.*?<\/div>/g, '<div class="kbcontent"></div>').replace(/<div class="kbcontent1">.*?<\/div>/g, '') });
    await assert.rejects(runImportFlow(env), /没有已排定/);
    assert.equal(calls.courses.length, 0);
});

test("a returned mode mismatch cannot import", async () => {
    const { env, calls } = environment();
    env.fetch = async (url, options) => ({ ok: true, url, text: async () => options.method ? timetable().replace('value="mode-test"', 'value="different-mode"') : timetable() });
    await assert.rejects(runImportFlow(env), /节次模式/);
    assert.equal(calls.courses.length, 0);
});

test("browser script entrypoint invokes the new bridge without CommonJS globals", async () => {
    const { env, calls } = environment();
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    env.shiguangBridge.notifyTaskCompletion = () => { calls.completed++; finish(); };
    const source = fs.readFileSync(require.resolve("../../resources/XJNU/xjnu.js"), "utf8");
    vm.runInNewContext(source, { window: env, URLSearchParams, URL });
    await finished;
    assert.equal(calls.completed, 1);
    assert.equal(calls.courses[0].length, 1);
    assert.equal(calls.configs.length, 0);
    assert.equal(calls.times, 0);
});
