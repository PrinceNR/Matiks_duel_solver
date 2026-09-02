/**
 * Logic Duel Solver V1 — Math Engine
 */

export function solvePuzzle(mode, rawValue) {
  const cleanMode = String(mode || '').toUpperCase().trim();
  const cleanVal = String(rawValue || '').trim();

  if (!cleanMode && !cleanVal) {
    return { answer: null, details: 'No puzzle detected.' };
  }

  // Basic Sprint/Duel arithmetic. Matiks often uses the generic instruction
  // "TYPE OUT YOUR ANSWER", so infer the operation from the expression itself.
  // Keep this before the root fallbacks so a value such as "12 ÷ 4" is not
  // accidentally interpreted as a square/cube-root prompt.
  const arithmeticPattern = /^\s*-?\d+(?:\.\d+)?(?:\s*[+\-−x×*÷/]\s*-?\d+(?:\.\d+)?){1,4}\s*$/i;
  if (arithmeticPattern.test(cleanVal)) {
    const result = solveArithmeticChain(cleanVal);
    if (Number.isFinite(result)) {
      return {
        answer: String(result),
        details: `${cleanVal} = ${result}`,
        kind: 'arithmetic',
        confidence: 'high',
      };
    }
  }

  // 1. TOP PRIORITY: MOD / REMAINDER (Check before roots to avoid conflict)
  if (cleanMode.includes('MOD') || cleanMode.includes('REMAINDER') || cleanVal.includes('%')) {
    const numbers = extractAllNumbers(cleanVal);
    if (numbers.length >= 2) {
      const [a, b] = numbers;
      const res = a % b;
      return { answer: String(res), details: `${a} % ${b} = ${res}` };
    }
  }

  // 2. TOP PRIORITY: m^n handling (Smart Fallback: agar scanner ne root ko power read kar liya ho, toh use root ki tarah bhi evaluate karein)[cite: 3]
  const powerMatch = cleanVal.replace(/√/g, '').match(/(\d+)\s*\^\s*(\d+)/);
  if (powerMatch && !cleanMode.includes('POWER_ONLY')) {
    const base = powerMatch[1];
    const exp = powerMatch[2];
    const concatVal = base + exp;
    const target = Number.parseInt(concatVal, 10);

    // Smart check: Agar ye asal mein root ka question tha jo power ban gaya, toh roots check karein
    const sqrt = Math.round(Math.sqrt(target));
    if (sqrt * sqrt === target) {
      return { answer: String(sqrt), details: `sqrt(${target}) = ${sqrt}` };
    }

    const cbrt = Math.round(Math.cbrt(target));
    if (cbrt * cbrt * cbrt === target) {
      return { answer: String(cbrt), details: `cbrt(${target}) = ${cbrt}` };
    }

    const bNum = Number.parseInt(base, 10);
    const eNum = Number.parseInt(exp, 10);
    if (Number.isFinite(bNum) && Number.isFinite(eNum)) {
      const res = Math.pow(bNum, eNum);
      return { answer: String(res), details: `${bNum}^${eNum} = ${res}` };
    }
  }

  // 3. Bracketed radical solving without changing the reader.
  // Try both valid interpretations in order and return the first exact result:
  //   √[2] 256       -> degree 2, target 256
  //   √[81] 2281     -> marker 22 means degree 2, target 81
  //   √[27] 3327     -> marker 33 means degree 3, target 27
  const bracketRootMatch = cleanVal.match(/√\s*\[\s*(\d+)\s*\]/);
  if (bracketRootMatch && (cleanMode.includes('ROOT') || cleanVal.includes('√'))) {
    const bracketValue = Number.parseInt(bracketRootMatch[1], 10);
    const afterBracket = cleanVal.replace(/^[\s\S]*?√\s*\[\s*\d+\s*\]/, '').trim();
    const repeatedDegree = afterBracket.match(/^(22|33)(?=\d|\s|$)/)?.[1];
    const outsideNumbers = extractAllNumbers(afterBracket);
    const candidates = [];

    // Candidate A: normal indexed-root notation, where [2]/[3] is degree.
    if ((bracketValue === 2 || bracketValue === 3) && outsideNumbers.length > 0) {
      candidates.push({ target: outsideNumbers[0], degree: bracketValue });
    }

    // Candidate B: bracket contains the target; 22/33 after it indicates degree.
    candidates.push({
      target: bracketValue,
      degree: repeatedDegree === '33' ? 3 : 2,
    });

    // Try every interpretation for an exact requested-degree root first.
    for (const candidate of candidates) {
      const exactRoot = Math.round(Math.pow(candidate.target, 1 / candidate.degree));
      if (Math.pow(exactRoot, candidate.degree) === candidate.target) {
        return {
          answer: String(exactRoot),
          details: `root[${candidate.degree}](${candidate.target}) = ${exactRoot}`,
        };
      }
    }

    // If neither interpretation resolves at its degree, try cube root for
    // each candidate before returning an approximate result.
    for (const candidate of candidates) {
      const cubeRoot = Math.round(Math.cbrt(candidate.target));
      if (cubeRoot * cubeRoot * cubeRoot === candidate.target) {
        return { answer: String(cubeRoot), details: `cbrt(${candidate.target}) = ${cubeRoot}` };
      }
    }

    const fallback = candidates[0];
    const fallbackRoot = Math.round(Math.pow(fallback.target, 1 / fallback.degree));
    return {
      answer: String(fallbackRoot),
      details: `approx root[${fallback.degree}](${fallback.target}) = ${fallbackRoot}`,
    };
  }

  // 3. Explicit POWER mode[cite: 3]
  if (cleanMode.includes('POWER') && cleanVal.includes('^')) {
    const parts = cleanVal.split('^');
    const base = Number.parseInt(parts[0], 10);
    const exp = Number.parseInt(parts[1], 10);
    if (Number.isFinite(base) && Number.isFinite(exp)) {
      const res = Math.pow(base, exp);
      return { answer: String(res), details: `${base}^${exp} = ${res}` };
    }
  }

  // 4. SUM OF SQUARES (e.g. "14" -> "3 2 1" or general multiple squares)[cite: 3]
  if (cleanMode.includes('SUM OF SQUARE') || cleanMode.includes('SQUARES')) {
    const numbers = extractAllNumbers(cleanVal);
    const target = numbers[0];
    if (Number.isFinite(target)) {
      const terms = findSumOfSquaresGeneralized(target);
      if (terms && terms.length > 0) {
        return {
          answer: terms.join(' '),
          details: `Sum of squares for ${target}: ${terms.map(t => t + '²').join(' + ')}`,
        };
      }
      return { answer: 'No pair', details: `Could not find integer square sum for ${target}` };
    }
  }

  // 5. PRIME FACTORIZATION (e.g. "10" -> "2 5")[cite: 3]
  if (cleanMode.includes('PRIME FACTOR')) {
    const numbers = extractAllNumbers(cleanVal);
    const target = numbers[0];
    if (Number.isFinite(target)) {
      const factors = getPrimeFactors(target);
      return {
        answer: factors.join(' '),
        details: `Prime factors of ${target}: ${factors.join(', ')}`,
      };
    }
  }

  // 6. HCF / GCD[cite: 3]
  if (cleanMode.includes('HCF') || cleanMode.includes('GCD')) {
    const numbers = extractAllNumbers(cleanVal);
    if (numbers.length >= 2) {
      const result = numbers.reduce((a, b) => gcd(a, b));
      return { answer: String(result), details: `HCF = ${result}` };
    }
  }

  // 7. LCM[cite: 3]
  if (cleanMode.includes('LCM')) {
    const numbers = extractAllNumbers(cleanVal);
    if (numbers.length >= 2) {
      const result = numbers.reduce((a, b) => lcm(a, b));
      return { answer: String(result), details: `LCM = ${result}` };
    }
  }

  // 8. ROOTS (Standard radical syntax e.g. √[3] 27 or √169)[cite: 3]
  if (cleanMode.includes('ROOT') || cleanVal.includes('√')) {
    const numbers = extractAllNumbers(cleanVal);
    const matchIndex = cleanVal.match(/√\[(\d+)\]/);
    const n = matchIndex ? Number.parseInt(matchIndex[1], 10) : 2;
    const target = numbers[numbers.length - 1];

    if (Number.isFinite(target)) {
      const sqrt = Math.round(Math.sqrt(target));
      if (sqrt * sqrt === target) {
        return { answer: String(sqrt), details: `sqrt(${target}) = ${sqrt}` };
      }
      const cbrt = Math.round(Math.cbrt(target));
      if (cbrt * cbrt * cbrt === target) {
        return { answer: String(cbrt), details: `cbrt(${target}) = ${cbrt}` };
      }
      const indexAns = Math.round(Math.pow(target, 1 / n));
      if (Math.pow(indexAns, n) === target) {
        return { answer: String(indexAns), details: `root[${n}](${target}) = ${indexAns}` };
      }
      return { answer: String(sqrt), details: `approx sqrt(${target}) = ${sqrt}` };
    }
  }

  // Fallback number extraction[cite: 3]
  const fallbackNums = extractAllNumbers(cleanVal);
  if (fallbackNums.length > 0) {
    const target = fallbackNums[fallbackNums.length - 1];
    const sqrt = Math.round(Math.sqrt(target));
    if (sqrt * sqrt === target) {
      return { answer: String(sqrt), details: `sqrt(${target}) = ${sqrt}` };
    }
    const cbrt = Math.round(Math.cbrt(target));
    if (cbrt * cbrt * cbrt === target) {
      return { answer: String(cbrt), details: `cbrt(${target}) = ${cbrt}` };
    }
    return { answer: String(target), details: `Value: ${target}` };
  }

  return { answer: null, details: 'Unrecognized puzzle mode.' };
}

function solveArithmeticChain(expression) {
  const normalized = String(expression)
    .replace(/−/g, '-')
    .replace(/[x×]/gi, '*')
    .replace(/÷/g, '/');
  const firstMatch = normalized.match(/^\s*(-?\d+(?:\.\d+)?)/);
  if (!firstMatch) return null;
  const parts = [firstMatch[1]];
  const remainder = normalized.slice(firstMatch[0].length);
  const termPattern = /\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/g;
  let consumed = 0;
  let match;
  while ((match = termPattern.exec(remainder))) {
    if (match.index !== consumed) return null;
    parts.push(match[1], match[2]);
    consumed = termPattern.lastIndex;
  }
  if (parts.length < 3 || consumed !== remainder.length) return null;

  const values = [Number(parts[0])];
  const additiveOperators = [];
  for (let index = 1; index < parts.length; index += 2) {
    const operator = parts[index];
    const value = Number(parts[index + 1]);
    if (!Number.isFinite(value)) return null;
    if (operator === '*' || operator === '/') {
      if (operator === '/' && value === 0) return null;
      const previous = values.pop();
      values.push(operator === '*' ? previous * value : previous / value);
    } else {
      additiveOperators.push(operator);
      values.push(value);
    }
  }

  let result = values[0];
  for (let index = 0; index < additiveOperators.length; index++) {
    result = additiveOperators[index] === '+' ? result + values[index + 1] : result - values[index + 1];
  }
  return result;
}

function extractAllNumbers(text) {
  const clean = String(text).replace(/√\[\d+\]/g, ' ');
  const matches = clean.match(/-?\d+/g);
  return matches ? matches.map((n) => Number.parseInt(n, 10)) : [];
}

function gcd(a, b) {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function lcm(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}

function getPrimeFactors(n) {
  let num = Math.abs(n);
  const factors = [];
  let d = 2;
  while (d * d <= num) {
    while (num % d === 0) {
      factors.push(d);
      num /= d;
    }
    d++;
  }
  if (num > 1) factors.push(num);
  return factors;
}

function findSumOfSquaresGeneralized(target) {
  if (target <= 0) return null;

  for (let a = Math.floor(Math.sqrt(target)); a >= 0; a--) {
    const b2 = target - a * a;
    const b = Math.round(Math.sqrt(b2));
    if (b * b === b2 && a > 0 && b > 0) {
      return [Math.max(a, b), Math.min(a, b)];
    }
  }

  function greedySearch(rem, currentTerms) {
    if (rem === 0) return currentTerms;
    if (currentTerms.length >= 10 || rem < 0) return null;

    let start = Math.floor(Math.sqrt(rem));
    if (start < 1) start = 1;

    for (let i = start; i >= 1; i--) {
      const res = greedySearch(rem - i * i, [...currentTerms, i]);
      if (res) return res;
    }
    return null;
  }

  return greedySearch(target, []);
}
