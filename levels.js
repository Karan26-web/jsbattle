// ============================================================================
// Level definitions.
//
// This file is TRUSTED app code (not user-submitted), so target render
// functions run directly on the main thread to produce the reference image.
// Only PLAYER code ever goes through sandbox.html.
//
// Every level carries a `par`: the character count of a competent, reasonably
// golfed solution. Scores are normalised against par so that a Visual Match
// win and a Code-Golf win are worth comparable XP (see ranks.js).
// ============================================================================

const CANVAS_SIZE = { w: 400, h: 300 };

const VISUAL_STARTER =
  "function render(ctx) {\n  // ctx is a 400x300 CanvasRenderingContext2D\n  // Draw here.\n}\n";

const VISUAL_LEVELS = [
  {
    slug: "traffic-light",
    type: "visual",
    title: "Traffic Light",
    difficulty: 1,
    par: 220,
    description:
      "Three circles stacked on a dark housing. Nothing fancy — get the geometry right.",
    hint: "Housing is a 100x220 rect at (150, 40). Circles are r=28 at x=200, y = 80, 150, 220.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#1b1b1b";
      ctx.fillRect(150, 40, 100, 220);
      const colors = ["#ff4d4d", "#ffd23f", "#4dff88"];
      colors.forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(200, 80 + i * 70, 28, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
      });
    }
  },
  {
    slug: "checkerboard",
    type: "visual",
    title: "Checkerboard",
    difficulty: 1,
    par: 165,
    description:
      "An 8x6 grid of 50px squares in alternating colours. A loop is much shorter than 48 fillRects.",
    hint: "(x + y) % 2 decides the colour. Teal is #5eead4, dark is #1e1b33.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = (x + y) % 2 ? "#5eead4" : "#1e1b33";
          ctx.fillRect(x * 50, y * 50, 50, 50);
        }
      }
    }
  },
  {
    slug: "eclipse",
    type: "visual",
    title: "Eclipse",
    difficulty: 2,
    par: 200,
    description:
      "A warm circle partially covered by a dark circle offset to the upper-right.",
    hint: "Fill the whole canvas #0b0b12 first, then an amber r=90 circle at (200,150), then a #0b0b12 r=90 circle at (235,115).",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#0b0b12";
      ctx.fillRect(0, 0, 400, 300);
      ctx.beginPath();
      ctx.arc(200, 150, 90, 0, Math.PI * 2);
      ctx.fillStyle = "#f5a623";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(235, 115, 90, 0, Math.PI * 2);
      ctx.fillStyle = "#0b0b12";
      ctx.fill();
    }
  },
  {
    slug: "bullseye",
    type: "visual",
    title: "Bullseye",
    difficulty: 2,
    par: 185,
    description:
      "Five concentric rings on a cream background, alternating red and cream.",
    hint: "Radii go 120, 96, 72, 48, 24 — draw largest first. Cream is #f7f4ec, red is #ff5470.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#f7f4ec";
      ctx.fillRect(0, 0, 400, 300);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(200, 150, 120 - i * 24, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 ? "#f7f4ec" : "#ff5470";
        ctx.fill();
      }
    }
  },
  {
    slug: "zen-diagonal",
    type: "visual",
    title: "Zen Diagonal",
    difficulty: 2,
    par: 235,
    description:
      "A diagonal two-tone split background with a single centered circle.",
    hint: "Background #211f35, then a triangle (0,300) -> (400,0) -> (400,300) in #5eead4, then a #ff5470 circle r=55 at the centre.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#211f35";
      ctx.fillRect(0, 0, 400, 300);
      ctx.beginPath();
      ctx.moveTo(0, 300);
      ctx.lineTo(400, 0);
      ctx.lineTo(400, 300);
      ctx.closePath();
      ctx.fillStyle = "#5eead4";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(200, 150, 55, 0, Math.PI * 2);
      ctx.fillStyle = "#ff5470";
      ctx.fill();
    }
  },
  {
    slug: "sunset-gradient",
    type: "visual",
    title: "Sunset",
    difficulty: 3,
    par: 230,
    description:
      "A vertical gradient sky with a sun sitting low. You will need createLinearGradient.",
    hint: "Gradient runs (0,0) -> (0,300), from #2b1055 to #ff5470. Sun is #ffd23f, r=60 at (200,190).",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, "#2b1055");
      g.addColorStop(1, "#ff5470");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 400, 300);
      ctx.beginPath();
      ctx.arc(200, 190, 60, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd23f";
      ctx.fill();
    }
  },
  {
    slug: "bar-chart",
    type: "visual",
    title: "Bar Chart",
    difficulty: 3,
    par: 235,
    description:
      "Six teal bars growing up from a baseline. Heights: 40, 110, 75, 160, 95, 130.",
    hint: "Background #131320. Bar i is 40 wide at x = 35 + i*60, bottom edge at y=270. Baseline is a #8b87a6 rect (20,272,360,3).",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#131320";
      ctx.fillRect(0, 0, 400, 300);
      const data = [40, 110, 75, 160, 95, 130];
      ctx.fillStyle = "#5eead4";
      data.forEach((v, i) => ctx.fillRect(35 + i * 60, 270 - v, 40, v));
      ctx.fillStyle = "#8b87a6";
      ctx.fillRect(20, 272, 360, 3);
    }
  },
  {
    slug: "mountains",
    type: "visual",
    title: "Mountains",
    difficulty: 3,
    par: 330,
    description:
      "Two overlapping peaks under a low sun. Order matters — the teal peak is drawn last.",
    hint: "Sky #1b2340. Sun #ffd23f r=34 at (310,70). Peak A: (0,300)->(140,110)->(280,300) in #3b4a7a. Peak B: (160,300)->(300,150)->(400,300) in #5eead4.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#1b2340";
      ctx.fillRect(0, 0, 400, 300);
      ctx.beginPath();
      ctx.arc(310, 70, 34, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd23f";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 300);
      ctx.lineTo(140, 110);
      ctx.lineTo(280, 300);
      ctx.closePath();
      ctx.fillStyle = "#3b4a7a";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(160, 300);
      ctx.lineTo(300, 150);
      ctx.lineTo(400, 300);
      ctx.closePath();
      ctx.fillStyle = "#5eead4";
      ctx.fill();
    }
  },
  {
    slug: "sine-wave",
    type: "visual",
    title: "Sine Wave",
    difficulty: 4,
    par: 210,
    description:
      "A single stroked sine curve across the canvas. Plot it point by point.",
    hint: "For x from 0 to 400: y = 150 + sin(x/40)*70. strokeStyle #5eead4, lineWidth 4, background #131320.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#131320";
      ctx.fillRect(0, 0, 400, 300);
      ctx.beginPath();
      for (let x = 0; x <= 400; x++) {
        const y = 150 + Math.sin(x / 40) * 70;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  },
  {
    slug: "color-wheel",
    type: "visual",
    title: "Colour Wheel",
    difficulty: 4,
    par: 245,
    description:
      "Twelve pie slices around a full circle, each a 30-degree step around the hue axis.",
    hint: "Slice i spans i*PI/6 to (i+1)*PI/6, r=110 at (200,150), fill hsl(i*30, 70%, 55%). Background #0b0b12.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#0b0b12";
      ctx.fillRect(0, 0, 400, 300);
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.moveTo(200, 150);
        ctx.arc(200, 150, 110, (i * Math.PI) / 6, ((i + 1) * Math.PI) / 6);
        ctx.closePath();
        ctx.fillStyle = `hsl(${i * 30}, 70%, 55%)`;
        ctx.fill();
      }
    }
  },
  {
    slug: "spiral",
    type: "visual",
    title: "Spiral",
    difficulty: 5,
    par: 250,
    description:
      "An Archimedean spiral, six full turns out from the centre. Polar coordinates are your friend.",
    hint: "For t from 0 to 12*PI step 0.05: r = t*3.2, x = 200 + cos(t)*r, y = 150 + sin(t)*r. Stroke #f5a623, lineWidth 3, background #0b0b12.",
    starterCode: VISUAL_STARTER,
    drawTarget(ctx) {
      ctx.fillStyle = "#0b0b12";
      ctx.fillRect(0, 0, 400, 300);
      ctx.beginPath();
      let first = true;
      for (let t = 0; t <= 12 * Math.PI; t += 0.05) {
        const r = t * 3.2;
        const x = 200 + Math.cos(t) * r;
        const y = 150 + Math.sin(t) * r;
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "#f5a623";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
];

const GOLF_LEVELS = [
  {
    slug: "vowel-count",
    type: "golf",
    title: "Vowel Count",
    difficulty: 1,
    par: 60,
    description:
      "Write solve(str) that returns how many vowels (a, e, i, o, u) the string contains, ignoring case.",
    hint: "A regex with the /gi flags and String.match gets this into one expression — remember match returns null when nothing is found.",
    starterCode: "function solve(str) {\n  \n}\n",
    visibleTests: [
      { input: ["hello"], expected: 2 },
      { input: ["JavaScript"], expected: 3 }
    ],
    hiddenTests: [
      { input: [""], expected: 0 },
      { input: ["xyz"], expected: 0 },
      { input: ["AEIOU"], expected: 5 },
      { input: ["The quick brown fox"], expected: 5 }
    ]
  },
  {
    slug: "sum-of-evens",
    type: "golf",
    title: "Sum of Evens",
    difficulty: 1,
    par: 70,
    description:
      "Write solve(arr) that returns the sum of all even numbers in the array.",
    hint: "filter then reduce works. So does a single reduce with a modulo guard — count the characters of both.",
    starterCode: "function solve(arr) {\n  \n}\n",
    visibleTests: [
      { input: [[1, 2, 3, 4]], expected: 6 },
      { input: [[5, 7, 9]], expected: 0 }
    ],
    hiddenTests: [
      { input: [[]], expected: 0 },
      { input: [[-2, -3, 4]], expected: 2 },
      { input: [[0, 1, 2, 3, 4, 5, 6]], expected: 12 }
    ]
  },
  {
    slug: "reverse-words",
    type: "golf",
    title: "Reverse Words",
    difficulty: 2,
    par: 70,
    description:
      "Write solve(str) that reverses the order of the words. Input has single spaces and no leading or trailing whitespace.",
    hint: "split, reverse, join — three calls, one line.",
    starterCode: "function solve(str) {\n  \n}\n",
    visibleTests: [
      { input: ["hello world"], expected: "world hello" },
      { input: ["one two three"], expected: "three two one" }
    ],
    hiddenTests: [
      { input: ["a"], expected: "a" },
      { input: [""], expected: "" },
      { input: ["the quick brown fox"], expected: "fox brown quick the" }
    ]
  },
  {
    slug: "palindrome-check",
    type: "golf",
    title: "Palindrome Check",
    difficulty: 2,
    par: 85,
    description:
      "Write solve(str) that returns true if str reads the same backwards, ignoring case. Spaces and punctuation count as characters.",
    hint: "Lowercase it once, then compare against the split/reverse/join of itself.",
    starterCode: "function solve(str) {\n  \n}\n",
    visibleTests: [
      { input: ["Racecar"], expected: true },
      { input: ["hello"], expected: false }
    ],
    hiddenTests: [
      { input: [""], expected: true },
      { input: ["A"], expected: true },
      { input: ["Was it a car or a cat I saw"], expected: false },
      { input: ["AbBa"], expected: true }
    ]
  },
  {
    slug: "flatten-deep",
    type: "golf",
    title: "Flatten Deep",
    difficulty: 2,
    par: 50,
    description:
      "Write solve(arr) that fully flattens an arbitrarily nested array of numbers.",
    hint: "There is a one-argument answer here that is very hard to beat.",
    starterCode: "function solve(arr) {\n  \n}\n",
    visibleTests: [
      { input: [[1, [2, [3, [4]]]]], expected: [1, 2, 3, 4] },
      { input: [[1, 2, 3]], expected: [1, 2, 3] }
    ],
    hiddenTests: [
      { input: [[]], expected: [] },
      { input: [[[[[]]]]], expected: [] },
      { input: [[[1], [[2]], [[[3]]]]], expected: [1, 2, 3] }
    ]
  },
  {
    slug: "chunk-array",
    type: "golf",
    title: "Chunk Array",
    difficulty: 2,
    par: 95,
    description:
      "Write solve(arr, size) that splits arr into sub-arrays of length size. The final chunk may be shorter.",
    hint: "Array.from with a computed length and an index-to-slice mapping avoids a manual loop.",
    starterCode: "function solve(arr, size) {\n  \n}\n",
    visibleTests: [
      { input: [[1, 2, 3, 4, 5], 2], expected: [[1, 2], [3, 4], [5]] },
      { input: [[1, 2, 3, 4], 4], expected: [[1, 2, 3, 4]] }
    ],
    hiddenTests: [
      { input: [[], 3], expected: [] },
      { input: [[1], 5], expected: [[1]] },
      { input: [[1, 2, 3, 4, 5, 6], 3], expected: [[1, 2, 3], [4, 5, 6]] }
    ]
  },
  {
    slug: "longest-common-prefix",
    type: "golf",
    title: "Longest Common Prefix",
    difficulty: 3,
    par: 130,
    description:
      "Write solve(arr) that returns the longest string prefix shared by every string in arr. Return \"\" if there is none or the array is empty.",
    hint: "Reduce across the array, trimming the running prefix until the next string starts with it.",
    starterCode: "function solve(arr) {\n  \n}\n",
    visibleTests: [
      { input: [["flower", "flow", "flight"]], expected: "fl" },
      { input: [["dog", "racecar", "car"]], expected: "" }
    ],
    hiddenTests: [
      { input: [[]], expected: "" },
      { input: [["alone"]], expected: "alone" },
      { input: [["same", "same", "same"]], expected: "same" },
      { input: [["ab", "abc", ""]], expected: "" }
    ]
  },
  {
    slug: "balanced-brackets",
    type: "golf",
    title: "Balanced Brackets",
    difficulty: 3,
    par: 150,
    description:
      "Write solve(str) that returns true if every (), [] and {} in the string is correctly opened and closed in order.",
    hint: "A stack of expected closers is the short route. Push on an opener, pop and compare on a closer, and finish only if the stack is empty.",
    starterCode: "function solve(str) {\n  \n}\n",
    visibleTests: [
      { input: ["([{}])"], expected: true },
      { input: ["([)]"], expected: false }
    ],
    hiddenTests: [
      { input: [""], expected: true },
      { input: ["()"], expected: true },
      { input: ["((("], expected: false },
      { input: [")("], expected: false },
      { input: ["{[()()]}"], expected: true }
    ]
  },
  {
    slug: "fizzbuzz-compressed",
    type: "golf",
    title: "FizzBuzz, Compressed",
    difficulty: 3,
    par: 125,
    description:
      "Write solve(n) that returns an array from 1 to n, replacing multiples of 3 with 'Fizz', multiples of 5 with 'Buzz', and multiples of both with 'FizzBuzz'.",
    hint: "Build the string by concatenation, then fall back to the number when it is still empty. Array.from covers the 1..n range in one call.",
    starterCode: "function solve(n) {\n  \n}\n",
    visibleTests: [{ input: [5], expected: [1, 2, "Fizz", 4, "Buzz"] }],
    hiddenTests: [
      { input: [1], expected: [1] },
      { input: [0], expected: [] },
      {
        input: [15],
        expected: [
          1, 2, "Fizz", 4, "Buzz", "Fizz", 7, 8, "Fizz", "Buzz", 11, "Fizz",
          13, 14, "FizzBuzz"
        ]
      }
    ]
  },
  {
    slug: "rotate-matrix",
    type: "golf",
    title: "Rotate Matrix",
    difficulty: 4,
    par: 100,
    description:
      "Write solve(m) that returns the square matrix m rotated 90 degrees clockwise. Do not mutate the input.",
    hint: "Row i of the result is column i of the input, read bottom to top. Map over the first row's indices.",
    starterCode: "function solve(m) {\n  \n}\n",
    visibleTests: [
      { input: [[[1, 2], [3, 4]]], expected: [[3, 1], [4, 2]] },
      {
        input: [[[1, 2, 3], [4, 5, 6], [7, 8, 9]]],
        expected: [[7, 4, 1], [8, 5, 2], [9, 6, 3]]
      }
    ],
    hiddenTests: [
      { input: [[[1]]], expected: [[1]] },
      { input: [[]], expected: [] },
      {
        input: [[[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
        expected: [
          [13, 9, 5, 1],
          [14, 10, 6, 2],
          [15, 11, 7, 3],
          [16, 12, 8, 4]
        ]
      }
    ]
  },
  {
    slug: "caesar-cipher",
    type: "golf",
    title: "Caesar Cipher",
    difficulty: 4,
    par: 165,
    description:
      "Write solve(str, shift) that shifts every letter forward by shift positions, wrapping z to a. Case is preserved and non-letters are left alone. shift is 0 or greater.",
    hint: "Use replace with /[a-z]/gi and charCodeAt. The base is 65 for uppercase, 97 for lowercase — derive it from the character itself.",
    starterCode: "function solve(str, shift) {\n  \n}\n",
    visibleTests: [
      { input: ["abc", 1], expected: "bcd" },
      { input: ["Hello, World!", 5], expected: "Mjqqt, Btwqi!" }
    ],
    hiddenTests: [
      { input: ["", 3], expected: "" },
      { input: ["abc", 0], expected: "abc" },
      { input: ["XYZ", 3], expected: "ABC" },
      { input: ["a-z", 26], expected: "a-z" },
      { input: ["Zebra 123", 1], expected: "Afcsb 123" }
    ]
  },
  {
    slug: "roman-numerals",
    type: "golf",
    title: "Roman Numerals",
    difficulty: 5,
    par: 175,
    description:
      "Write solve(n) that converts an integer from 1 to 3999 into a Roman numeral string.",
    hint: "Greedy subtraction over a value/symbol table that already includes the subtractive pairs (900 = CM, 400 = CD, 90 = XC, 40 = XL, 9 = IX, 4 = IV).",
    starterCode: "function solve(n) {\n  \n}\n",
    visibleTests: [
      { input: [4], expected: "IV" },
      { input: [58], expected: "LVIII" }
    ],
    hiddenTests: [
      { input: [1], expected: "I" },
      { input: [9], expected: "IX" },
      { input: [40], expected: "XL" },
      { input: [1994], expected: "MCMXCIV" },
      { input: [3999], expected: "MMMCMXCIX" }
    ]
  }
];

const ALL_LEVELS = [...VISUAL_LEVELS, ...GOLF_LEVELS];
const LEVELS_BY_SLUG = Object.fromEntries(ALL_LEVELS.map((l) => [l.slug, l]));
