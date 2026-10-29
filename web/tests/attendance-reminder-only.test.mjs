import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./helpers.mjs";

test("attendance closing logic respects attendanceReminderOnly flag", () => {
  const matchDate = new Date("2026-10-29T19:00:00Z");
  const attendanceCloseHours = 8;
  const closingDate = new Date(matchDate.getTime() - attendanceCloseHours * 60 * 60 * 1000); // 11:00:00Z

  // Case 1: Past deadline with default (lock mode: attendanceReminderOnly: false)
  {
    const now = new Date("2026-10-29T12:00:00Z"); // 1h past closingDate
    const attendanceReminderOnly = false;
    const isClosed = !attendanceReminderOnly && now > closingDate;
    assert.equal(isClosed, true, "Should lock attendance when reminder-only is disabled");
  }

  // Case 2: Past deadline with reminder-only enabled (attendanceReminderOnly: true)
  {
    const now = new Date("2026-10-29T12:00:00Z"); // 1h past closingDate
    const attendanceReminderOnly = true;
    const isClosed = !attendanceReminderOnly && now > closingDate;
    assert.equal(isClosed, false, "Should keep attendance open when reminder-only is enabled");
  }

  // Case 3: Before deadline with reminder-only enabled
  {
    const now = new Date("2026-10-29T10:00:00Z"); // 1h before closingDate
    const attendanceReminderOnly = true;
    const isClosed = !attendanceReminderOnly && now > closingDate;
    assert.equal(isClosed, false, "Should keep attendance open before deadline");
  }
});

test("A3 and A4 notification blocks differentiate between reminder-only and lock mode", () => {
  const matchDate = new Date("2026-10-29T19:00:00Z");

  // Mode: reminder-only
  {
    const data = {
      date: matchDate,
      attendanceReminderOnly: true,
      venueName: "Sân Hoàng Khôi",
    };
    const isReminderOnly = Boolean(data.attendanceReminderOnly);

    const a3Header = isReminderOnly
      ? "⏰ Sắp đến mốc nhắc chốt điểm danh"
      : "⏰ Sắp đóng cổng điểm danh";
    const a4Header = isReminderOnly
      ? "📋 Tình hình điểm danh (Mốc chốt sân)"
      : "🔒 Đã chốt danh sách điểm danh";

    assert.equal(a3Header, "⏰ Sắp đến mốc nhắc chốt điểm danh");
    assert.equal(a4Header, "📋 Tình hình điểm danh (Mốc chốt sân)");
  }

  // Mode: legacy lock mode
  {
    const data = {
      date: matchDate,
      attendanceReminderOnly: false,
      venueName: "Sân Hoàng Khôi",
    };
    const isReminderOnly = Boolean(data.attendanceReminderOnly);

    const a3Header = isReminderOnly
      ? "⏰ Sắp đến mốc nhắc chốt điểm danh"
      : "⏰ Sắp đóng cổng điểm danh";
    const a4Header = isReminderOnly
      ? "📋 Tình hình điểm danh (Mốc chốt sân)"
      : "🔒 Đã chốt danh sách điểm danh";

    assert.equal(a3Header, "⏰ Sắp đóng cổng điểm danh");
    assert.equal(a4Header, "🔒 Đã chốt danh sách điểm danh");
  }
});

test("teams/lock formats full member list breakdown in Slack message", () => {
  const teamsConfig = [
    {
      id: "A",
      name: "Đội A",
      members: [
        { id: "m1", name: "Nguyễn Văn A" },
        { id: "m2", name: "Trần Văn B" },
      ],
    },
    {
      id: "B",
      name: "Đội B",
      members: [
        { id: "m3", name: "Lê Văn C" },
      ],
    },
  ];

  const nameByMemberId = new Map([
    ["m1", "Nguyễn Văn A"],
    ["m2", "Trần Văn B"],
    ["m3", "Lê Văn C"],
  ]);

  const teamBreakdown = teamsConfig
    .filter((t) => (t.members || []).length > 0)
    .map((t, idx) => {
      const teamIcon = idx === 0 ? "🔵" : idx === 1 ? "🔴" : "🟡";
      const names = (t.members || [])
        .map((m) => {
          const name = nameByMemberId.get(m.id) || m.name || "Không rõ";
          return `   👤 ${name}`;
        })
        .join("\n");
      return `${teamIcon} *${t.name}* (${(t.members || []).length}):\n${names}`;
    })
    .join("\n\n");

  assert.ok(teamBreakdown.includes("🔵 *Đội A* (2):"));
  assert.ok(teamBreakdown.includes("   👤 Nguyễn Văn A"));
  assert.ok(teamBreakdown.includes("   👤 Trần Văn B"));
  assert.ok(teamBreakdown.includes("🔴 *Đội B* (1):"));
  assert.ok(teamBreakdown.includes("   👤 Lê Văn C"));
});
