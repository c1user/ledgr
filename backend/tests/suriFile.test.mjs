import { buildSuriFile } from "../src/services/suriFile.js";

const payer = {
  name: "Boricua Books LLC",
  tax_id: "66-1234567",
  address: "123 Calle Sol",
  city: "San Juan",
  state: "PR",
  zip: "00901",
};
const vendors = [
  {
    name: "Boricua Consulting LLC",
    ein: "66-7654321",
    address: "45 Ave Ponce de Leon",
    city: "Ponce",
    state: "PR",
    zip: "00716",
    gross_paid: 1000,
    subject: 1000,
    withheld: 100,
    not_subject: 0,
    waiver_certificate_no: null,
  },
  {
    name: "Taller Grafico Inc",
    ein: "66-1111222",
    address: "8 Calle Luna",
    city: "Mayaguez",
    state: "PR",
    zip: "00680",
    gross_paid: 750.5,
    subject: 0,
    withheld: 0,
    not_subject: 750.5,
    waiver_certificate_no: "WAIV-2025-001",
  },
];

const { content, filename } = buildSuriFile({
  payer,
  vendors,
  year: 2025,
  controlStart: 500001,
  contactEmail: "demo@ledgr.test",
});

const lines = content.split("\r\n").filter(Boolean);
const at = (line, from, to) => lines[line].slice(from - 1, to); // 1-based inclusive

const checks = [
  ["6 records (SU, PA, 2 details, SP2, 480.5)", lines.length === 6],
  ["all records 2500 chars", lines.every((l) => l.length === 2500)],
  ["filename", filename === "F4806SPY25.txt"],
  // SU
  ["SU id", at(0, 1, 2) === "SU"],
  ["SU ein 3-11", at(0, 3, 11) === "661234567"],
  ["SU resub 12", at(0, 12, 12) === "0"],
  ["SU software 13-14", at(0, 13, 14) === "98"],
  ["SU name 15-71", at(0, 15, 71).startsWith("BORICUA BOOKS LLC")],
  ["SU email 435-474", at(0, 435, 474).startsWith("DEMO@LEDGR.TEST")],
  // PA
  ["PA id", at(1, 1, 2) === "PA"],
  ["PA year 3-6", at(1, 3, 6) === "2025"],
  ["PA ein 8-16", at(1, 8, 16) === "661234567"],
  ["PA form H 17", at(1, 17, 17) === "H"],
  ["PA file type 22", at(1, 22, 22) === "O"],
  // detail #1 (subject to withholding)
  ["D1 control 2-10", at(2, 2, 10) === "000500001"],
  ["D1 payee type 11", at(2, 11, 11) === "1"],
  ["D1 form H 13", at(2, 13, 13) === "H"],
  ["D1 record 14", at(2, 14, 14) === "1"],
  ["D1 doc 15", at(2, 15, 15) === "O"],
  ["D1 year 18-21", at(2, 18, 21) === "2025"],
  ["D1 payer ein 32-40", at(2, 32, 40) === "661234567"],
  ["D1 payer town 141-153", at(2, 141, 153).startsWith("SAN JUAN")],
  ["D1 payee ein 167-175", at(2, 167, 175) === "667654321"],
  ["D1 payee name 196-225", at(2, 196, 225).startsWith("BORICUA CONSULTING LLC")],
  ["D1 item1 zero 321-332", at(2, 321, 332) === "000000000000"],
  ["D1 item2 zero 333-344", at(2, 333, 344) === "000000000000"],
  ["D1 corp subject 367-378", at(2, 367, 378) === "000000100000"],
  ["D1 corp withheld 379-388", at(2, 379, 388) === "0000010000"],
  ["D1 no waiver 434-453", at(2, 434, 453).trim() === ""],
  // detail #2 (not subject, has waiver)
  ["D2 control 2-10", at(3, 2, 10) === "000500002"],
  ["D2 corp not-subject 333-344", at(3, 333, 344) === "000000075050"],
  ["D2 corp withheld zero 379-388", at(3, 379, 388) === "0000000000"],
  ["D2 waiver 434-453", at(3, 434, 453).startsWith("WAIV-2025-001")],
  // SP.2 (line index 4)
  ["SP2 control zeros 2-10", at(4, 2, 10) === "000000000"],
  ["SP2 form I 13", at(4, 13, 13) === "I"],
  ["SP2 year 18-21", at(4, 18, 21) === "2025"],
  ["SP2 payer ein 48-56", at(4, 48, 56) === "661234567"],
  ["SP2 total forms 324-333", at(4, 324, 333) === "0000000002"],
  ["SP2 corps not-subject 394-408", at(4, 394, 408) === "000000000075050"],
  ["SP2 corps subject 439-453", at(4, 439, 453) === "000000000100000"],
  ["SP2 corps withheld 454-468", at(4, 454, 468) === "000000000010000"],
  ["SP2 total payments 469-483", at(4, 469, 483) === "000000000175050"],
  ["SP2 total withheld 484-498", at(4, 484, 498) === "000000000010000"],
  ["SP2 specialist flags 499-500", at(4, 499, 500) === "00"],
  // 480.5 (line index 5)
  ["4805 control zeros 2-10", at(5, 2, 10) === "000000000"],
  ["4805 form H 13", at(5, 13, 13) === "H"],
  ["4805 year 18-21", at(5, 18, 21) === "2025"],
  ["4805 payer ein 24-32", at(5, 24, 32) === "661234567"],
  ["4805 doc count 159-168", at(5, 159, 168) === "0000000002"],
  ["4805 total withheld 169-183", at(5, 169, 183) === "000000000010000"],
  ["4805 total paid 184-198", at(5, 184, 198) === "000000000175050"],
];

let pass = 0;
let fail = 0;
for (const [label, ok] of checks) {
  if (ok) pass++;
  else {
    fail++;
    console.log("FAIL:", label);
  }
}
console.log(`${pass} pass, ${fail} fail of ${checks.length}`);
if (fail > 0) process.exit(1);
