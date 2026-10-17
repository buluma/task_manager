import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from './markdown.js';

const md = markdownToHtml;

test('paragraphs and line breaks', () => {
  assert.equal(md('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
  assert.equal(md('  \n  '), '');
});

test('headings map to small heading levels', () => {
  assert.equal(md('# Big'), '<h3>Big</h3>');
  assert.equal(md('## Mid'), '<h4>Mid</h4>');
  assert.equal(md('### Small\n#### Smaller\n###### Tiny'), '<h5>Small</h5><h6>Smaller</h6><h6>Tiny</h6>');
  assert.equal(md('#nospace'), '<p>#nospace</p>');
});

test('inline styles: bold, italic, strike and code', () => {
  assert.equal(
    md('a **bold** and *it* and _it2_ and ~~gone~~ and `code`'),
    '<p>a <b>bold</b> and <i>it</i> and <i>it2</i> and <s>gone</s> and <code>code</code></p>',
  );
});

test('inline code is literal: markdown inside it is not interpreted', () => {
  assert.equal(md('`**not bold** <b>`'), '<p><code>**not bold** &lt;b&gt;</code></p>');
});

test('words that only look like emphasis are left alone', () => {
  assert.equal(md('snake_case_name and src/*.js and 2 * 3 * 4'), '<p>snake_case_name and src/*.js and 2 * 3 * 4</p>');
});

test('bullet and numbered lists', () => {
  assert.equal(md('* one\n* two **b**\n\n1. first\n2. second'), '<ul><li>one</li><li>two <b>b</b></li></ul><ol><li>first</li><li>second</li></ol>');
  assert.equal(md('- dash\n- items'), '<ul><li>dash</li><li>items</li></ul>');
  assert.equal(md('text\n* then list'), '<p>text</p><ul><li>then list</li></ul>');
});

test('fenced code blocks keep their text verbatim, escaped', () => {
  assert.equal(md('```\n[WARN] a < b && c\n  indented\n```'), '<pre><code>[WARN] a &lt; b &amp;&amp; c\n  indented</code></pre>');
  assert.equal(md('```js\nlet x = 1;\n```\nafter'), '<pre><code>let x = 1;</code></pre><p>after</p>');
  assert.equal(md('```\nunclosed'), '<pre><code>unclosed</code></pre>');
});

test('tables are kept as aligned preformatted text', () => {
  assert.equal(md('| a | b |\n| -- | -- |\n| 1 | 2 |'), '<pre>| a | b |\n| -- | -- |\n| 1 | 2 |</pre>');
});

test('blockquotes and rules', () => {
  assert.equal(md('> quoted\n> more'), '<blockquote>quoted<br>more</blockquote>');
  assert.equal(md('above\n\n---\n\nbelow'), '<p>above</p><hr><p>below</p>');
});

test('links: markdown links and bare URLs for http(s) and mailto, nothing else', () => {
  assert.equal(
    md('[docs](https://example.com/a?b=1&c=2)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>',
  );
  assert.equal(
    md('see http://10.0.0.189:3190, ok.'),
    '<p>see <a href="http://10.0.0.189:3190" target="_blank" rel="noopener noreferrer">http://10.0.0.189:3190</a>, ok.</p>',
  );
  assert.equal(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(md('[mail](mailto:a@b.co)'), '<p><a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">mail</a></p>');
});

test('HTML in the input is always escaped, whatever the position', () => {
  const html = md('<script>alert(1)</script>\n\n# <img src=x onerror=alert(1)>\n\n* <b onclick=x>\n\n> <i>\n\n[<u>t</u>](https://e.co/"onmouseover="x)');
  assert.doesNotMatch(html, /<script|<img|<b onclick|<i>|<u>|onmouseover="x/);
  assert.match(html, /&lt;script&gt;/);
});
