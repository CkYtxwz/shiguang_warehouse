// 新疆师范大学本科教务适配 — CkYtxwz
// 使用用户已登录的同源会话，不保存账号、密码或 Cookie。
// 首版按节次导入并提示教学周历，保留目标课表已有的作息和配置。
(function (root) {
    "use strict";

    const ORIGIN = "https://jwxt.xjnu.edu.cn";
    const TIMETABLE_PATH = "/jsxsd/xskb/xskb_list.do";
    const CALENDAR_PATH = "/jsxsd/jxzl/jxzl_query";
    const text = node => (node?.textContent || "").replace(/\s+/g, " ").trim();
    const cells = row => Array.from(row.children).filter(el => /^(TD|TH)$/.test(el.tagName));

    function numberList(value, maximum) {
        const expression = value.replace(/[，、]/g, ",").replace(/[－—–~～至]/g, "-").replace(/\s/g, "");
        if (!/^\d+(?:-\d+)*(?:,\d+(?:-\d+)*)*$/.test(expression)) {
            throw new Error("无法识别周次或节次：" + value);
        }
        const result = new Set();
        for (const part of expression.split(",")) {
            const values = part.split("-").map(Number);
            if (values.some(n => n < 1 || n > maximum)) throw new Error("周次或节次超出范围：" + value);
            if (values.length === 2) {
                if (values[0] > values[1]) throw new Error("周次或节次顺序错误：" + value);
                for (let n = values[0]; n <= values[1]; n++) result.add(n);
            } else {
                // 强智使用 01-02-03 表示逐节列举；非连续的枚举不可扩成连堂。
                values.forEach(n => result.add(n));
            }
        }
        return Array.from(result).sort((a, b) => a - b);
    }

    function parseSchedule(value) {
        const normalized = value.replace(/（/g, "(").replace(/）/g, ")")
            .replace(/【/g, "[").replace(/】/g, "]");
        const sectionMatch = normalized.match(/\[([^\]]*?)节\]/);
        if (!sectionMatch) throw new Error("课程缺少具体节次：" + value);
        const weekPart = normalized.slice(0, sectionMatch.index);
        const weekExpression = weekPart.replace(/[()单双周第\s]/g, "");
        let weeks = numberList(weekExpression, 60);
        if (weekPart.includes("单") && weekPart.includes("双")) throw new Error("无法识别单双周：" + value);
        if (weekPart.includes("单")) weeks = weeks.filter(n => n % 2 === 1);
        if (weekPart.includes("双")) weeks = weeks.filter(n => n % 2 === 0);
        if (!weeks.length) throw new Error("课程没有有效周次：" + value);
        const sections = numberList(sectionMatch[1], 30);
        const ranges = [];
        for (const section of sections) {
            const last = ranges[ranges.length - 1];
            if (last && last.endSection + 1 === section) last.endSection = section;
            else ranges.push({ startSection: section, endSection: section });
        }
        return { weeks, ranges };
    }

    function weekday(value) {
        const match = value.match(/^(?:星期|周)([一二三四五六日天1-7])$/);
        if (!match) return null;
        return { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 }[match[1]] || Number(match[1]);
    }

    function weekdayColumns(table) {
        for (const row of table.querySelectorAll("tr")) {
            const days = cells(row).map(cell => weekday(text(cell)));
            if (new Set(days.filter(Boolean)).size === 7) return days;
        }
        throw new Error("未识别到星期表头，教务页面结构可能已变化。");
    }

    function courseName(block) {
        let name = "";
        for (const node of block.childNodes) {
            if (node.nodeName === "BR") break;
            name += node.textContent || "";
        }
        return name.replace(/\s+/g, " ").trim();
    }

    function unscheduledCourses(doc) {
        const table = doc.getElementById("dataTables");
        if (!table) return [];
        let nameColumn = -1;
        const names = new Set();
        for (const row of table.querySelectorAll("tr")) {
            const values = cells(row).map(text);
            const header = values.indexOf("课程名称");
            if (header >= 0) { nameColumn = header; continue; }
            if (nameColumn >= 0 && /^\d+$/.test(values[0]) && values[nameColumn]) names.add(values[nameColumn]);
        }
        return Array.from(names);
    }

    function assertLoggedIn(doc) {
        if (doc.querySelector('#userAccount, #userPassword, form[action*="LoginToXk"]') || /登录/.test(doc.title || "")) {
            throw new Error("尚未登录或登录已失效，请在教务页面重新登录后执行导入。");
        }
    }

    function parseTimetable(doc) {
        assertLoggedIn(doc);
        const table = doc.getElementById("timetable");
        if (!table) throw new Error("未找到学期理论课表，请确认登录成功；若仍失败，教务页面结构可能已变化。");
        const days = weekdayColumns(table);
        const unique = new Map();
        for (const row of table.querySelectorAll("tr")) {
            const rowCells = cells(row);
            for (let column = 0; column < rowCells.length; column++) {
                const cell = rowCells[column];
                const details = Array.from(cell.querySelectorAll(".kbcontent")).filter(div => text(div));
                if (!details.length) {
                    if (Array.from(cell.querySelectorAll(".kbcontent1")).some(div => text(div))) {
                        throw new Error("课表仅包含简略信息，无法确认具体节次，请重新加载教务页面。");
                    }
                    continue;
                }
                if (!days[column] || rowCells.length !== days.length) throw new Error("课程星期列不匹配，已停止导入以避免错位。");
                for (const detail of details) {
                    for (const html of detail.innerHTML.split(/-{5,}|─{5,}|<hr\b[^>]*>/i)) {
                        const block = doc.createElement("div");
                        block.innerHTML = html;
                        if (!text(block)) continue;
                        // 分隔线前后可能有空行，不把首个空 <br> 误当课程名称。
                        while (block.firstChild && (block.firstChild.nodeName === "BR" || !text(block.firstChild))) block.firstChild.remove();
                        const name = courseName(block);
                        const weekInfo = text(block.querySelector('font[title="周次(节次)"]'));
                        if (!name || !weekInfo) throw new Error("有课程缺少名称或排课信息，已停止导入，请检查学期理论课表。");
                        const teacher = text(block.querySelector('font[title="教师"], font[title="老师"]'));
                        const position = text(block.querySelector('font[title="教室"]'));
                        const remark = text(block.querySelector('[name="jxbz"]')).slice(0, 300);
                        const schedule = parseSchedule(weekInfo);
                        for (const range of schedule.ranges) {
                            const course = { name, teacher, position, day: days[column], ...range, weeks: schedule.weeks.slice() };
                            if (remark) course.remark = remark;
                            const key = JSON.stringify([name, teacher, position, course.day, course.startSection, course.endSection, remark]);
                            const previous = unique.get(key);
                            if (previous) previous.weeks = Array.from(new Set([...previous.weeks, ...course.weeks])).sort((a, b) => a - b);
                            else unique.set(key, course);
                        }
                    }
                }
            }
        }
        const courses = Array.from(unique.values()).sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
        return { courses, unscheduled: unscheduledCourses(doc) };
    }

    function selectOptions(doc, id) {
        const select = doc.getElementById(id);
        if (!select) return [];
        return Array.from(select.querySelectorAll("option")).filter(option => option.value).map(option => ({
            value: option.value, label: text(option), selected: option.hasAttribute("selected")
        }));
    }

    function selectedValue(doc, id) {
        const options = selectOptions(doc, id);
        return (options.find(option => option.selected) || options[0])?.value;
    }

    function parseCalendar(doc, semester) {
        assertLoggedIn(doc);
        if (selectedValue(doc, "xnxq01id") !== semester) throw new Error("教学周历的学期与选择不一致。");
        const table = doc.getElementById("kbtable");
        if (!table) throw new Error("没有读取到教学周历。");
        const columns = weekdayColumns(table);
        const mondayColumn = columns.indexOf(1);
        let startDate = null;
        let totalWeeks = 0;
        for (const row of table.querySelectorAll("tr")) {
            const rowCells = cells(row);
            if (!/^\d+$/.test(text(rowCells[0]))) continue;
            const week = Number(text(rowCells[0]));
            if (week < 1 || week > 60) throw new Error("教学周历周次异常。");
            totalWeeks = Math.max(totalWeeks, week);
            if (week === 1) {
                const title = rowCells[mondayColumn]?.getAttribute("title") || "";
                const match = title.match(/^(\d{4})年(\d{1,2})月(\d{1,2})(?:日)?$/);
                if (match) {
                    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
                    const iso = match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
                    if (date.toISOString().slice(0, 10) === iso && date.getUTCDay() === 1) startDate = iso;
                }
            }
        }
        if (!startDate || !totalWeeks) throw new Error("教学周历缺少有效的第一周日期或总周数。");
        return { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks, firstDayOfWeek: 1 };
    }

    function bridges(env) {
        return { async: env.shiguangBridgePromise || env.AndroidBridgePromise, sync: env.shiguangBridge || env.AndroidBridge };
    }

    async function requestDocument(env, path, params) {
        const options = { credentials: "same-origin", cache: "no-store" };
        if (params) {
            options.method = "POST";
            options.headers = { "Content-Type": "application/x-www-form-urlencoded" };
            options.body = new URLSearchParams(params).toString();
        }
        const controller = new env.AbortController();
        options.signal = controller.signal;
        const timeout = env.setTimeout(() => controller.abort(), 30000);
        try {
            const response = await env.fetch(ORIGIN + path, options);
            if (!response.ok) throw new Error("教务系统请求失败（HTTP " + response.status + "），请稍后重试。");
            if (response.url && new URL(response.url).origin !== ORIGIN) throw new Error("教务登录已失效，请重新登录。");
            const doc = new env.DOMParser().parseFromString(await response.text(), "text/html");
            assertLoggedIn(doc);
            return doc;
        } catch (error) {
            if (error.name === "AbortError") throw new Error("教务系统响应超时，请稍后重试。");
            throw error;
        } finally { env.clearTimeout(timeout); }
    }

    async function choose(api, title, options) {
        const preferred = Math.max(0, options.findIndex(option => option.selected));
        const index = await api.showSingleSelection(title, JSON.stringify(options.map(option => option.label)), preferred);
        if (index === null || index === undefined || index === -1) return null;
        if (!Number.isInteger(index) || !options[index]) throw new Error("未能识别选择结果，请更新拾光后重试。");
        return options[index].value;
    }

    async function runImportFlow(env) {
        const bridge = bridges(env);
        const api = bridge.async;
        if (!api) throw new Error("请通过拾光课程表的教务导入或适配测试入口运行此脚本。");
        if (env.location.origin !== ORIGIN) throw new Error("请先打开 https://jwxt.xjnu.edu.cn/jsxsd/ 并登录教务系统，再执行导入。");
        const initial = await requestDocument(env, TIMETABLE_PATH);
        const semesters = selectOptions(initial, "xnxq01id").filter(option => /^\d{4}-\d{4}-[12]$/.test(option.value));
        if (!semesters.length) throw new Error("未找到可选学期，请确认已进入学生教务系统。");
        const semester = await choose(api, "选择导入学期", semesters);
        if (semester === null) return { status: "cancelled" };
        const modes = selectOptions(initial, "kbjcmsid");
        if (!modes.length) throw new Error("没有读取到学校的节次模式。");
        const mode = modes.length === 1 ? modes[0].value : await choose(api, "选择节次模式", modes);
        if (mode === null) return { status: "cancelled" };
        const doc = await requestDocument(env, TIMETABLE_PATH, {
            xnxq01id: semester, kbjcmsid: mode, zc: "", sfFD: "1", wkbkc: "1"
        });
        if (selectedValue(doc, "xnxq01id") !== semester) throw new Error("返回课表的学期与选择不一致，已停止导入。");
        if (selectedValue(doc, "kbjcmsid") !== mode) throw new Error("返回课表的节次模式与选择不一致，已停止导入。");
        const parsed = parseTimetable(doc);
        if (!parsed.courses.length) throw new Error("所选学期没有已排定时间的课程。无课表课程暂时无法导入。");
        let config = null;
        let calendarWarning = "";
        try {
            config = parseCalendar(await requestDocument(env, CALENDAR_PATH, { xnxq01id: semester }), semester);
            if (parsed.courses.some(course => course.weeks.some(week => week > config.semesterTotalWeeks))) {
                throw new Error("课程周次超出教学周历范围。");
            }
        } catch (error) {
            config = null;
            calendarWarning = "未取得匹配的教学周历，导入后请手动核对开学日期和总周数。";
        }
        const count = new Set(parsed.courses.map(course => course.name)).size;
        const summary = [semester + "：" + count + " 门课程，" + parsed.courses.length + " 条上课安排。",
            "按节次导入，保留目标课表已有作息时间。"];
        if (config) summary.push("教学周历：第一周从 " + config.semesterStartDate + " 开始，共 " + config.semesterTotalWeeks + " 周。请在目标课表设置中核对。");
        if (calendarWarning) summary.push(calendarWarning);
        if (parsed.unscheduled.length) summary.push("教务的“无课表课程”列表中还有以下记录；未排定的安排不导入，已排定的安排仍正常导入：\n" + parsed.unscheduled.join("、"));
        const confirmed = await api.showAlert("核对导入内容", summary.join("\n\n"), "导入课程");
        if (!confirmed) return { status: "cancelled" };
        if (await api.saveImportedCourses(JSON.stringify(parsed.courses)) !== true) {
            throw new Error("课程未保存，导入已取消或失败。");
        }
        // App 的 saveCourseConfig 会把省略的课时长度重置为默认值，且桥接层没有读取配置接口。
        // 不调用它，也不调用 savePresetTimeSlots，确保完整保留用户现有的作息配置。
        await api.showAlert("导入完成", "已导入 " + count + " 门课程，" + parsed.courses.length + " 条上课安排。请核对目标课表已有作息时间。" +
            (config ? "\n\n教学周历：第一周开始日期 " + config.semesterStartDate + "，共 " + config.semesterTotalWeeks + " 周。请在课表设置中核对；本次未修改这些设置。" : "") +
            (calendarWarning ? "\n\n" + calendarWarning : ""), "完成");
        bridge.sync?.notifyTaskCompletion?.();
        return { status: "imported", courseCount: count, arrangementCount: parsed.courses.length, calendar: config, calendarWarning };
    }

    // Node 单元测试只加载纯解析函数，不访问网络或触发 App 导入。
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { numberList, parseSchedule, parseTimetable, parseCalendar, selectOptions, runImportFlow };
        return;
    }
    runImportFlow(root).catch(async error => {
        const bridge = bridges(root);
        const message = error?.message || "导入失败，请检查网络和登录状态后重试。";
        if (bridge.async?.showAlert) await bridge.async.showAlert("导入未完成", message, "知道了");
        else if (bridge.sync?.showToast) bridge.sync.showToast(message);
        else root.alert(message);
    });
})(typeof window !== "undefined" ? window : globalThis);
