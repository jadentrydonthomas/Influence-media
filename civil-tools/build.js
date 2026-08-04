// Build script: inlines the engine + shapes database into src/ui.html to
// produce the fully self-contained beam-designer.html (works when opened as a
// single file, no sibling js/ folder needed).
//
//   node civil-tools/build.js [artifact-output-path]
//
// The optional second output is the same content without the <!DOCTYPE>/<html>
// skeleton (for publishing environments that wrap the body themselves).

var fs = require("fs");
var path = require("path");
var dir = __dirname;

var ui = fs.readFileSync(path.join(dir, "src/ui.html"), "utf8");
var shapes = fs.readFileSync(path.join(dir, "js/aisc-shapes.js"), "utf8");
var engine = fs.readFileSync(path.join(dir, "js/beam-engine.js"), "utf8");

ui = ui.replace("/*__SHAPES__*/", function () { return shapes; })
       .replace("/*__ENGINE__*/", function () { return engine; });

// artifact flavor: keep as-is (content-only, includes <title>)
var artifactOut = process.argv[2];
if (artifactOut) {
  fs.writeFileSync(artifactOut, ui);
  console.log("wrote " + artifactOut);
}

// standalone flavor: strip the leading <title> line and wrap with a skeleton
var TITLE = "Steel Beam Designer — AISC 16th Ed.";
var body = ui.replace(/^<title>[^<]*<\/title>\s*/, "");
var standalone = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
  "<title>" + TITLE + "</title>\n</head>\n<body>\n" + body + "\n</body>\n</html>\n";
fs.writeFileSync(path.join(dir, "beam-designer.html"), standalone);
console.log("wrote " + path.join(dir, "beam-designer.html"));
