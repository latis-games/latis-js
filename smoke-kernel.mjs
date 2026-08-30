import { LatisEngine } from "./engine.js";

const e = new LatisEngine(3, 3);
if (e.len() !== 9) throw new Error("len");
if (!e.place(0, 1)) throw new Error("place");
if (e.cell(0) !== 1) throw new Error("cell");
if (e.place(0, 2)) throw new Error("occupied should fail");
e.place(1, 1);
e.place(2, 1);
const line = Array.from(e.kInARow(3));
if (line.join(",") !== "0,1,2") throw new Error("kInARow " + line);
const five = new LatisEngine(5, 5);
if (five.len() !== 25) throw new Error("5x5");
const n = e.neighbors(0);
if (n.join(",") !== "1,3,4") throw new Error("neighbors " + n);
if (e.place(99, 1)) throw new Error("oob place");
console.log("smoke ok", e.cols(), "x", e.rows(), "line", line);
