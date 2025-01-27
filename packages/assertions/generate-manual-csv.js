/*
 *  Copyright (c) 2023 Contributors to the Eclipse Foundation
 *
 *  See the NOTICE file(s) distributed with this work for additional
 *  information regarding copyright ownership.
 *
 *  This program and the accompanying materials are made available under the
 *  terms of the Eclipse Public License v. 2.0 which is available at
 *  http://www.eclipse.org/legal/epl-2.0, or the W3C Software Notice and
 *  Document License (2015-05-13) which is available at
 *  https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document.
 *
 *  SPDX-License-Identifier: EPL-2.0 OR W3C-20150513
 */

/** ========================================================================
 *                           Includes and Globals
 *========================================================================**/
// JSON to CSV and vice versa libraries
const Json2CsvParser = require("json2csv").Parser;
const csvjson = require("csvjson");
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");

const csvGenerator = new Json2CsvParser({
    fields: ["ID", "Status", "Comment", "Assertion"],
});
const mainPath = path.join("assertions-csv");
const assertionsPath = path.join("assertions-csv", "assertions.csv");
const preImplementedPath = path.join("assertions-csv", "manual-generation-inputs", "pre-implemented.csv");
const manualFlag = "not testable with Assertion Tester";

/** ========================================================================
 *                           Read and Parse CSV
 *========================================================================**/

const assertionsTableCSV = readFileSync(assertionsPath, {
    encoding: "utf-8",
});
const preImplementedPathCSV = readFileSync(preImplementedPath, {
    encoding: "utf-8",
});

const csvParserOptions = {
    delimiter: ",", // optional
    quote: '"', // optional
};

const assertionsTable = csvjson.toObject(assertionsTableCSV, csvParserOptions);
const preImplementedTable = csvjson.toObject(preImplementedPathCSV, csvParserOptions);

/** ========================================================================
 *                   Determine and Remove Old Assertions
 *========================================================================**/

const oldAssertionsTable = [];
let index = 0;
let iterations = preImplementedTable.length;
for (let iteration = 0; iteration < iterations; iteration++) {
    const isNotFound =
        assertionsTable.findIndex((assertion) => {
            return preImplementedTable[index].ID === assertion.ID;
        }) === -1;
    if (isNotFound) {
        oldAssertionsTable.push({
            ID: preImplementedTable[index].ID,
            Assertion: preImplementedTable[index].Assertion,
            Comment: manualFlag,
        });
        preImplementedTable.splice(index, 1);
    } else {
        index++;
    }
}

/** ========================================================================
 *                           Determine Manual CSV
 *========================================================================**/
const manualTable = [];
const needsReviewTable = [];

/* ================== Add old manual assertions ================= */

index = 0;
iterations = preImplementedTable.length;
for (let iteration = 0; iteration < iterations; iteration++) {
    if (preImplementedTable[index].Comment === manualFlag) {
        manualTable.push({
            ID: preImplementedTable[index].ID,
            Status: "null",
            Assertion: preImplementedTable[index].Assertion,
            Comment: manualFlag,
        });
        preImplementedTable.splice(index, 1);
    } else {
        preImplementedTable[index].Status = "null";
        preImplementedTable[index].Comment = null;
        index++;
    }
}
/* ================== Add new manual assertions ================= */
for (const assertion of assertionsTable) {
    const isNotFound =
        preImplementedTable.findIndex((implementedAssertion) => {
            return implementedAssertion.ID === assertion.ID;
        }) === -1;
    const manualIsNotFound =
        manualTable.findIndex((manualAssertion) => {
            return manualAssertion.ID === assertion.ID;
        }) === -1;
    if (isNotFound && manualIsNotFound) {
        manualTable.push({
            ID: assertion.ID,
            Status: "null",
            Assertion: assertion.Assertion,
            Comment: manualFlag,
        });
        needsReviewTable.push({
            ID: assertion.ID,
            Status: "null",
            Assertion: assertion.Assertion,
            Comment: manualFlag,
        });
    }
}

/** ========================================================================
 *                           Sanity Check
 *========================================================================**/

const assertionsSize = assertionsTable.length;
const implementedSize = preImplementedTable.length;
const manualSize = manualTable.length;
const oldSize = oldAssertionsTable.length;
const needsReviewSize = needsReviewTable.length;

// expectedSize = implementedSize + manualSize + oldSize

// assert.deepEqual(expectedSize, assertionsSize)

/** ========================================================================
 *                           Output CSVs
 *========================================================================**/
console.log("Generating implemented.csv");
writeFileSync(path.join(mainPath, "implemented.csv"), csvGenerator.parse(preImplementedTable));

console.log("Generating manual.csv");
writeFileSync(path.join(mainPath, "manual.csv"), csvGenerator.parse(manualTable));

console.log("Generating needsReview.csv");
writeFileSync(path.join(mainPath, "needsReview.csv"), csvGenerator.parse(needsReviewTable));

console.log("Generating old.csv");
writeFileSync(path.join(mainPath, "old.csv"), csvGenerator.parse(oldAssertionsTable));

console.log("Generating report.json");
const report = {
    generationDate: new Date().toUTCString(),
    assertionsSize,
    implementedSize,
    manualSize,
    oldSize,
    needsReviewSize,
};

writeFileSync(path.join(mainPath, "report.json"), JSON.stringify(report));
