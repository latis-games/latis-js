/*!
 * meshoptimizer MIT. Copyright (C) 2016-2026 Arseny Kapoulkine (arseny.kapoulkine@gmail.com)
 * Based on js/meshopt_decoder_reference.js (Jasper St. Pierre).
 * Stripped to decodeVertexBuffer + decodeIndexBuffer (no WASM, no SIMD pair,
 * no decodeIndexSequence / decodeGltfBuffer / vertex filters).
 * Bundled into engine.min-vnext.js via esbuild. Do not terser -c on this file
 * in isolation — compress can break vertex decode.
 */

const MeshoptDecoder = {};
MeshoptDecoder.supported = true;
MeshoptDecoder.ready = Promise.resolve();

function assert(cond) {
  if (!cond) throw new Error("meshopt: assert");
}

function dezig(v) {
  return (v >>> 1) ^ -(v & 1);
}

MeshoptDecoder.decodeVertexBuffer = (target, elementCount, byteStride, source, filter) => {
  if (filter && filter !== "NONE") throw new Error("meshopt: filter " + filter + " not in this build");
  assert(source[0] === 0xa0 || source[0] === 0xa1);
  const version = source[0] & 0x0f;

  const maxBlockElements = Math.min((0x2000 / byteStride) & ~0x000f, 0x100);
  const deltas = new Uint8Array(maxBlockElements * byteStride);
  const tailSize = version === 0 ? byteStride : byteStride + byteStride / 4;
  const tailDataOffs = source.length - tailSize;
  const tempData = source.slice(tailDataOffs, tailDataOffs + byteStride);
  const channels = version === 0 ? null : source.slice(tailDataOffs + byteStride, tailDataOffs + tailSize);

  let srcOffs = 1;
  const headerModes = [
    [0, 2, 4, 8],
    [0, 1, 2, 4],
    [1, 2, 4, 8],
  ];

  for (let dstElemBase = 0; dstElemBase < elementCount; dstElemBase += maxBlockElements) {
    const attrBlockElementCount = Math.min(elementCount - dstElemBase, maxBlockElements);
    const groupCount = ((attrBlockElementCount + 0x0f) & ~0x0f) >>> 4;
    const headerByteCount = ((groupCount + 0x03) & ~0x03) >>> 2;
    const controlBitsOffs = srcOffs;
    srcOffs += version === 0 ? 0 : byteStride / 4;
    deltas.fill(0x00);

    for (let byte = 0; byte < byteStride; byte++) {
      const deltaBase = byte * attrBlockElementCount;
      const controlMode = version === 0 ? 0 : (source[controlBitsOffs + (byte >>> 2)] >>> ((byte & 0x03) << 1)) & 0x03;

      if (controlMode === 2) {
        continue;
      } else if (controlMode === 3) {
        deltas.set(source.subarray(srcOffs, srcOffs + attrBlockElementCount), deltaBase);
        srcOffs += attrBlockElementCount;
        continue;
      }

      const headerBitsOffs = srcOffs;
      srcOffs += headerByteCount;

      for (let group = 0; group < groupCount; group++) {
        const mode = (source[headerBitsOffs + (group >>> 2)] >>> ((group & 0x03) << 1)) & 0x03;
        const modeBits = headerModes[version === 0 ? 0 : controlMode + 1][mode];
        const deltaOffs = deltaBase + (group << 4);

        if (modeBits === 0) {
        } else if (modeBits === 1) {
          const srcBase = srcOffs;
          srcOffs += 0x02;
          for (let m = 0; m < 0x10; m++) {
            const shift = m & 0x07;
            let delta = (source[srcBase + (m >>> 3)] >>> shift) & 0x01;
            if (delta === 1) delta = source[srcOffs++];
            deltas[deltaOffs + m] = delta;
          }
        } else if (modeBits === 2) {
          const srcBase = srcOffs;
          srcOffs += 0x04;
          for (let m = 0; m < 0x10; m++) {
            const shift = 6 - ((m & 0x03) << 1);
            let delta = (source[srcBase + (m >>> 2)] >>> shift) & 0x03;
            if (delta === 3) delta = source[srcOffs++];
            deltas[deltaOffs + m] = delta;
          }
        } else if (modeBits === 4) {
          const srcBase = srcOffs;
          srcOffs += 0x08;
          for (let m = 0; m < 0x10; m++) {
            const shift = 4 - ((m & 0x01) << 2);
            let delta = (source[srcBase + (m >>> 1)] >>> shift) & 0x0f;
            if (delta === 0xf) delta = source[srcOffs++];
            deltas[deltaOffs + m] = delta;
          }
        } else {
          deltas.set(source.subarray(srcOffs, srcOffs + 0x10), deltaOffs);
          srcOffs += 0x10;
        }
      }
    }

    for (let elem = 0; elem < attrBlockElementCount; elem++) {
      const dstElem = dstElemBase + elem;
      for (let byteGroup = 0; byteGroup < byteStride; byteGroup += 4) {
        const channelMode = version === 0 ? 0 : channels[byteGroup >>> 2] & 0x03;
        assert(channelMode !== 0x03);

        if (channelMode === 0) {
          for (let byte = byteGroup; byte < byteGroup + 4; byte++) {
            const delta = dezig(deltas[byte * attrBlockElementCount + elem]);
            const temp = (tempData[byte] + delta) & 0xff;
            const dstOffs = dstElem * byteStride + byte;
            target[dstOffs] = tempData[byte] = temp;
          }
        } else if (channelMode === 1) {
          for (let byte = byteGroup; byte < byteGroup + 4; byte += 2) {
            const delta = dezig(deltas[byte * attrBlockElementCount + elem] + (deltas[(byte + 1) * attrBlockElementCount + elem] << 8));
            let temp = tempData[byte] + (tempData[byte + 1] << 8);
            temp = (temp + delta) & 0xffff;
            const dstOffs = dstElem * byteStride + byte;
            target[dstOffs] = tempData[byte] = temp & 0xff;
            target[dstOffs + 1] = tempData[byte + 1] = temp >>> 8;
          }
        } else if (channelMode === 2) {
          const byte = byteGroup;
          const delta =
            deltas[byte * attrBlockElementCount + elem] +
            (deltas[(byte + 1) * attrBlockElementCount + elem] << 8) +
            (deltas[(byte + 2) * attrBlockElementCount + elem] << 16) +
            (deltas[(byte + 3) * attrBlockElementCount + elem] << 24);
          let temp = tempData[byte] + (tempData[byte + 1] << 8) + (tempData[byte + 2] << 16) + (tempData[byte + 3] << 24);
          const rot = channels[byteGroup >>> 2] >>> 4;
          temp = temp ^ ((delta >>> rot) | (delta << (32 - rot)));
          const dstOffs = dstElem * byteStride + byte;
          target[dstOffs] = tempData[byte] = temp & 0xff;
          target[dstOffs + 1] = tempData[byte + 1] = (temp >>> 8) & 0xff;
          target[dstOffs + 2] = tempData[byte + 2] = (temp >>> 16) & 0xff;
          target[dstOffs + 3] = tempData[byte + 3] = temp >>> 24;
        }
      }
    }
  }

  const tailSizePadded = Math.max(tailSize, version === 0 ? 32 : 24);
  assert(srcOffs == source.length - tailSizePadded);
};

function readfifo(fifo, n) {
  return fifo[(fifo.offset - 1 - n) & (fifo.length - 1)];
}

function pushfifo(fifo, n) {
  const offset = fifo.offset;
  fifo[offset] = n;
  fifo.offset = (offset + 1) & (fifo.length - 1);
}

MeshoptDecoder.decodeIndexBuffer = (target, count, byteStride, source) => {
  assert(source[0] === 0xe1);
  assert(count % 3 === 0);
  assert(byteStride === 2 || byteStride === 4);

  let dst;
  if (byteStride === 2) dst = new Uint16Array(target.buffer, target.byteOffset, count);
  else dst = new Uint32Array(target.buffer, target.byteOffset, count);

  const triCount = count / 3;
  let codeOffs = 0x01;
  let dataOffs = codeOffs + triCount;
  let codeauxOffs = source.length - 0x10;

  function readLEB128() {
    let n = 0;
    for (let i = 0; ; i += 7) {
      const b = source[dataOffs++];
      n |= (b & 0x7f) << i;
      if (b < 0x80) return n;
    }
  }

  let next = 0,
    last = 0;
  const edgefifo = new Uint32Array(32);
  const vertexfifo = new Uint32Array(16);
  edgefifo.offset = 0;
  vertexfifo.offset = 0;

  function decodeIndex(v) {
    return (last += dezig(v));
  }

  let dstOffs = 0;
  for (let i = 0; i < triCount; i++) {
    const code = source[codeOffs++];
    const b0 = code >>> 4,
      b1 = code & 0x0f;

    if (b0 < 0x0f) {
      const a = readfifo(edgefifo, (b0 << 1) + 0),
        b = readfifo(edgefifo, (b0 << 1) + 1);
      let c = -1;

      if (b1 === 0x00) {
        c = next++;
        pushfifo(vertexfifo, c);
      } else if (b1 < 0x0d) {
        c = readfifo(vertexfifo, b1);
      } else if (b1 === 0x0d) {
        c = --last;
        pushfifo(vertexfifo, c);
      } else if (b1 === 0x0e) {
        c = ++last;
        pushfifo(vertexfifo, c);
      } else if (b1 === 0x0f) {
        const v = readLEB128();
        c = decodeIndex(v);
        pushfifo(vertexfifo, c);
      }

      pushfifo(edgefifo, b);
      pushfifo(edgefifo, c);
      pushfifo(edgefifo, c);
      pushfifo(edgefifo, a);

      dst[dstOffs++] = a;
      dst[dstOffs++] = b;
      dst[dstOffs++] = c;
    } else {
      let a = -1,
        b = -1,
        c = -1;

      if (b1 < 0x0e) {
        const e = source[codeauxOffs + b1];
        const z = e >>> 4,
          w = e & 0x0f;

        a = next++;

        if (z === 0x00) b = next++;
        else b = readfifo(vertexfifo, z - 1);

        if (w === 0x00) c = next++;
        else c = readfifo(vertexfifo, w - 1);

        pushfifo(vertexfifo, a);
        if (z === 0x00) pushfifo(vertexfifo, b);
        if (w === 0x00) pushfifo(vertexfifo, c);
      } else {
        const e = source[dataOffs++];
        if (e === 0x00) next = 0;

        const z = e >>> 4,
          w = e & 0x0f;

        if (b1 === 0x0e) a = next++;
        else a = decodeIndex(readLEB128());

        if (z === 0x00) b = next++;
        else if (z === 0x0f) b = decodeIndex(readLEB128());
        else b = readfifo(vertexfifo, z - 1);

        if (w === 0x00) c = next++;
        else if (w === 0x0f) c = decodeIndex(readLEB128());
        else c = readfifo(vertexfifo, w - 1);

        pushfifo(vertexfifo, a);
        if (z === 0x00 || z === 0x0f) pushfifo(vertexfifo, b);
        if (w === 0x00 || w === 0x0f) pushfifo(vertexfifo, c);
      }

      pushfifo(edgefifo, a);
      pushfifo(edgefifo, b);
      pushfifo(edgefifo, b);
      pushfifo(edgefifo, c);
      pushfifo(edgefifo, c);
      pushfifo(edgefifo, a);

      dst[dstOffs++] = a;
      dst[dstOffs++] = b;
      dst[dstOffs++] = c;
    }
  }
};

export { MeshoptDecoder };
