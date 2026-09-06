#!/usr/bin/env node
// Idempotent installer for the dsh-sidepanel plugin.
//   node scripts/install.mjs              symlink + profile patch row (no restart)
//   node scripts/install.mjs --restart    also kickstart the DSH launchd service
//   node scripts/install.mjs --uninstall  remove the patch row + symlink
// Re-running is safe: it skips work that is already in place.
import { symlinkSync, readFileSync, writeFileSync, existsSync, lstatSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import url from "node:url";

const pkgRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME : path.join(os.homedir(), ".dsh");
// both artifacts derive from the same dshHome: with DSH_HOME set the symlink
// and the patch row must land in the same home or the loader sees only one
const profilesRoot = path.join(dshHome, "profiles");
const linkTarget = path.join(profilesRoot, "node_modules", "dsh-sidepanel");
const patchFile = path.join(profilesRoot, "web", "cordis.patch.yml");
const patchPath = patchFile;

// 1. symlink the package into the profile node_modules
let step1 = "skipped (already linked)";
let linkOk = false;
try {
	const st = lstatSync(linkTarget);
	if (st.isSymbolicLink()) {
		// existsSync follows the link: a dangling link reports false and gets repaired
		if (existsSync(linkTarget) && readFileSync(linkTarget + "/package.json", "utf8").includes("dsh-sidepanel")) {
			linkOk = true;
		}
	} else if (st.isDirectory()) {
		step1 = "ERROR: " + linkTarget + " exists as a real directory; refusing to touch it";
		console.error(step1);
		process.exit(1);
	}
} catch {
	// no entry yet: create it below
}
if (!linkOk) {
	try {
		symlinkSync(pkgRoot, linkTarget);
		step1 = "linked " + linkTarget + " -> " + pkgRoot;
	} catch (error) {
		if (error.code === "EEXIST") {
			step1 = "linked (replaced stale/dangling entry)";
			rmSync(linkTarget, { force: true });
			symlinkSync(pkgRoot, linkTarget);
		} else {
			throw error;
		}
	}
}
console.log("[1/2]", step1);

// 2. add the loader insert row to the web profile patch layer

if (process.argv.includes("--uninstall")) {
	let removed = false;
	if (existsSync(patchPath)) {
		const text = readFileSync(patchPath, "utf8");
		if (text.includes("dsh-sidepanel")) {
			const lines = text.split("\n");
			const out = [];
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].startsWith("# dsh-sidepanel:")) {
					// structure-driven removal: drop the comment lines, then every
					// non-empty, non-comment line of the record that follows (record
					// blocks are blank-line terminated) — resilient to indentation or
					// row-shape edits, unlike fixed line counts or prefix guessing
					while (i < lines.length && lines[i].startsWith("#")) i += 1;
					let sawRecord = false;
					while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#")) {
						sawRecord = true;
						i += 1;
					}
					if (sawRecord) removed = true;
					i -= 1; // the loop's i++ lands on the first non-record line
					continue;
				}
				out.push(lines[i]);
			}
			const next = out.join("\n").replace(/\n{3,}$/, "\n");
			writeFileSync(patchPath, next);
		}
	}
	try {
		rmSync(linkTarget, { force: true });
	} catch {
		// nothing to remove
	}
	console.log("[uninstall] patch row removed:", removed, "; symlink removed");
	const uid = execSync("id -u").toString().trim();
	execSync(`launchctl kickstart -k gui/${uid}/com.deepseek.dsh`, { stdio: "inherit" });
	console.log("[uninstall] DSH restarted; /sidepanel routes are gone");
	process.exit(0);
}

const before = readFileSync(patchPath, "utf8");
let step2 = "skipped (row already present)";
let after = before;
if (!before.includes("name: dsh-sidepanel") && !before.includes("'dsh-sidepanel'") && !before.includes('"dsh-sidepanel"')) {
	const row = "# dsh-sidepanel: right side panel (session artifacts + side chat).\n# Package source: " + pkgRoot + " (symlinked into " + linkTarget + ")\n- insert:\n    - id: sidepanel\n      name: dsh-sidepanel\n";
	after = before.replace(/\s*$/, "\n") + row;
	writeFileSync(patchPath, after);
	step2 = "insert row appended to " + patchPath;
}
console.log("[2/2]", step2);

if (process.argv.includes("--restart")) {
	const uid = execSync("id -u").toString().trim();
	execSync(`launchctl kickstart -k gui/${uid}/com.deepseek.dsh`, { stdio: "inherit" });
	console.log("[restart] launchctl kickstart sent; DSH will come back within a few seconds");
} else {
	console.log("Done. Restart DSH to load the plugin:  launchctl kickstart -k gui/$(id -u)/com.deepseek.dsh");
	console.log("Then verify:  curl http://127.0.0.1:3080/sidepanel/health");
}
