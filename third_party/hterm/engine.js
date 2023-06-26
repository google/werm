#include <tm_defines>

// SOURCE FILE: hterm/js/hterm_screen.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview This class represents a single terminal screen full of text.
 *
 * It maintains the current cursor position and has basic methods for text
 * insert and overwrite, and adding or removing rows from the screen.
 *
 * This class has no knowledge of the scrollback buffer.
 *
 * The number of rows on the screen is determined only by the number of rows
 * that the caller inserts into the screen.  If a caller wants to ensure a
 * constant number of rows on the screen, it's their responsibility to remove a
 * row for each row inserted.
 *
 * The screen width, in contrast, is enforced locally.
 *
 *
 * In practice...
 * - The hterm.Terminal class holds two hterm.Screen instances.  One for the
 * primary screen and one for the alternate screen.
 *
 * - The html.Screen class only cares that rows are HTML Elements.  In the
 * larger context of hterm, however, the rows happen to be displayed by an
 * hterm.ScrollPort and have to follow a few rules as a result.  Each
 * row must be rooted by the custom HTML tag 'x-row', and each must have a
 * rowIndex property that corresponds to the index of the row in the context
 * of the scrollback buffer.  These invariants are enforced by hterm.Terminal
 * because that is the class using the hterm.Screen in the context of an
 * hterm.ScrollPort.
 */

/**
 * Create a new screen instance.
 *
 * The screen initially has no rows and a maximum column count of 0.
 *
 * @param {number=} columnCount The maximum number of columns for this
 *    screen.  See insertString() and overwriteString() for information about
 *    what happens when too many characters are added too a row.  Defaults to
 *    0 if not provided.
 * @constructor
 */
hterm.Screen = function() {
  /**
   * Public, read-only access to the rows in this screen.
   *
   * @type {!Array<!Element>}
   */
  this.rowsArray = [];

  // The max column width for this screen.
  this.columnCount_ = 0;

  // The current color, bold, underline and blink attributes.
  this.scrTextAttr = new hterm.TextAttributes(window.document);

  // Current zero-based cursor coordinates.
  this.cursrow = 0;
  this.curscol = 0;
  this.cursovrfl = 0;

  // Saved state used by DECSC and related settings.  This is only for saving
  // and restoring specific state, not for the current/active state.
  this.cursorState_ = new hterm.Screen_CursorState(this);

  // The node containing the row that the cursor is positioned on.
  this.cursorRowNode_ = null;

  // The node containing the span of text that the cursor is positioned on.
  this.cursorNode_ = null;

  // The offset in column width into cursorNode_ where the cursor is positioned.
  this.cursorOffset_ = 0;
};

/**
 * Return the current number of rows in this screen.
 *
 * @return {number} The number of rows in this screen.
 */
hterm.Screen.prototype.getHeight = function() {
  return this.rowsArray.length;
};

/**
 * Set the maximum number of columns per row.
 *
 * @param {number} count The maximum number of columns per row.
 */
hterm.Screen.prototype.setColumnCount = function(count) {
  this.columnCount_ = count;

  if (this.curscol >= count) {
    this.setCursorPosition(this.cursrow, count - 1);
  }
};

/**
 * Insert a row at the top of the screen.
 *
 * @param {!Element} row The row to insert.
 */
hterm.Screen.prototype.unshiftRow = function(row) {
  this.rowsArray.splice(0, 0, row);
};

/**
 * Insert rows at the top of the screen.
 *
 * @param {!Array<!Element>} rows The rows to insert.
 */
hterm.Screen.prototype.unshiftRows = function(rows) {
  this.rowsArray.unshift.apply(this.rowsArray, rows);
};

/**
 * Remove the last row from the screen and return it.
 *
 * @return {!Element} The last row in this screen.
 */
hterm.Screen.prototype.popRow = function() {
  return this.popRows(1)[0];
};

/**
 * Remove rows from the bottom of the screen and return them as an array.
 *
 * @param {number} count The number of rows to remove.
 * @return {!Array<!Element>} The selected rows.
 */
hterm.Screen.prototype.popRows = function(count) {
  return this.rowsArray.splice(this.rowsArray.length - count, count);
};

/**
 * Insert a row at the bottom of the screen.
 *
 * @param {!Element} row The row to insert.
 */
hterm.Screen.prototype.pushRow = function(row) {
  this.rowsArray.push(row);
};

/**
 * Insert rows at the bottom of the screen.
 *
 * @param {!Array<!Element>} rows The rows to insert.
 */
hterm.Screen.prototype.pushRows = function(rows) {
  rows.push.apply(this.rowsArray, rows);
};

/**
 * Insert a row at the specified row of the screen.
 *
 * @param {number} index The index to insert the row.
 * @param {!Element} row The row to insert.
 */
hterm.Screen.prototype.insertRow = function(index, row) {
  this.rowsArray.splice(index, 0, row);
};

/**
 * Insert rows at the specified row of the screen.
 *
 * @param {number} index The index to insert the rows.
 * @param {!Array<!Element>} rows The rows to insert.
 */
hterm.Screen.prototype.insertRows = function(index, rows) {
  for (let i = 0; i < rows.length; i++) {
    this.rowsArray.splice(index + i, 0, rows[i]);
  }
};

/**
 * Remove a row from the screen and return it.
 *
 * @param {number} index The index of the row to remove.
 * @return {!Element} The selected row.
 */
hterm.Screen.prototype.removeRow = function(index) {
  return this.rowsArray.splice(index, 1)[0];
};

/**
 * Remove rows from the bottom of the screen and return them as an array.
 *
 * @param {number} index The index to start removing rows.
 * @param {number} count The number of rows to remove.
 * @return {!Array<!Element>} The selected rows.
 */
hterm.Screen.prototype.removeRows = function(index, count) {
  return this.rowsArray.splice(index, count);
};

/**
 * Clear the contents of the cursor row.
 */
hterm.Screen.prototype.clearCursorRow = function() {
  this.cursorRowNode_.innerText = '';
  this.cursorRowNode_.removeAttribute('line-overflow');
  this.cursorOffset_ = 0;
  this.curscol = 0;
  this.cursovrfl = 0;

  let text;
  if (this.scrTextAttr.isDefault()) {
    text = '';
  } else {
    text = ' '.repeat(this.columnCount_);
  }

  // We shouldn't honor inverse colors when clearing an area, to match
  // xterm's back color erase behavior.
  const inverse = this.scrTextAttr.inverse;
  this.scrTextAttr.inverse = false;
  this.scrTextAttr.syncColors();

  const node = this.scrTextAttr.createContainer(text);
  this.cursorRowNode_.appendChild(node);
  this.cursorNode_ = node;

  this.scrTextAttr.inverse = inverse;
  this.scrTextAttr.syncColors();
};

/**
 * Mark the current row as having overflowed to the next line.
 *
 * The line overflow state is used when converting a range of rows into text.
 * It makes it possible to recombine two or more overflow terminal rows into
 * a single line.
 *
 * This is distinct from the cursor being in the overflow state.  Cursor
 * overflow indicates that printing at the cursor position will commit a
 * line overflow, unless it is preceded by a repositioning of the cursor
 * to a non-overflow state.
 */
hterm.Screen.prototype.commitLineOverflow = function() {
  this.cursorRowNode_.setAttribute('line-overflow', true);
};

/**
 * Relocate the cursor to a give row and column.
 *
 * @param {number} row The zero based row.
 * @param {number} column The zero based column.
 */
hterm.Screen.prototype.setCursorPosition = function(row, column) {
  if (!this.rowsArray.length) {
    console.warn('Attempt to set cursor position on empty screen.');
    return;
  }

  if (row >= this.rowsArray.length) {
    console.error('Row out of bounds: ' + row);
    row = this.rowsArray.length - 1;
  } else if (row < 0) {
    console.error('Row out of bounds: ' + row);
    row = 0;
  }

  if (column >= this.columnCount_) {
    console.error('Column out of bounds: ' + column);
    column = this.columnCount_ - 1;
  } else if (column < 0) {
    console.error('Column out of bounds: ' + column);
    column = 0;
  }

  this.cursovrfl = 0;

  const rowNode = this.rowsArray[row];
  let node = rowNode.firstChild;

  if (!node) {
    node = rowNode.ownerDocument.createTextNode('');
    rowNode.appendChild(node);
  }

  let currentColumn = 0;

  if (rowNode == this.cursorRowNode_) {
    if (column >= this.curscol - this.cursorOffset_) {
      node = this.cursorNode_;
      currentColumn = this.curscol - this.cursorOffset_;
    }
  } else {
    this.cursorRowNode_ = rowNode;
  }

  this.cursrow = row;
  this.curscol = column;
  this.cursovrfl = 0;

  while (node) {
    const offset = column - currentColumn;
    const width = hterm.TextAttributes.nodeWidth(node);
    if (!node.nextSibling || width > offset) {
      this.cursorNode_ = node;
      this.cursorOffset_ = offset;
      return;
    }

    currentColumn += width;
    node = node.nextSibling;
  }
};

/**
 * Set the provided selection object to be a caret selection at the current
 * cursor position.
 *
 * @param {!Selection} selection
 */
hterm.Screen.prototype.syncSelectionCaret = function(selection) {
  try {
    selection.collapse(this.cursorNode_, this.cursorOffset_);
  } catch (firefoxIgnoredException) {
    // FF can throw an exception if the range is off, rather than just not
    // performing the collapse.
  }
};

/**
 * Split a single node into two nodes at the given offset.
 *
 * For example:
 * Given the DOM fragment '<div><span>Hello World</span></div>', call splitNode_
 * passing the span and an offset of 6.  This would modify the fragment to
 * become: '<div><span>Hello </span><span>World</span></div>'.  If the span
 * had any attributes they would have been copied to the new span as well.
 *
 * The to-be-split node must have a container, so that the new node can be
 * placed next to it.
 *
 * @param {!Node} node The node to split.
 * @param {number} offset The offset into the node where the split should
 *     occur.
 */
hterm.Screen.prototype.splitNode_ = function(node, offset) {
  const afterNode = node.cloneNode(false);

  const textContent = node.textContent;
  node.textContent = hterm.TextAttributes.nodeSubstr(node, 0, offset);
  afterNode.textContent = lib.wc.substr(textContent, offset);

  if (afterNode.textContent) {
    node.parentNode.insertBefore(afterNode, node.nextSibling);
  }
  if (!node.textContent) {
    node.remove();
  }
};

/**
 * Ensure that text is clipped and the cursor is clamped to the column count.
 */
hterm.Screen.prototype.maybeClipCurrentRow = function() {
  TMint currentColumn;

  let width = hterm.TextAttributes.nodeWidth(lib.notNull(this.cursorRowNode_));

  if (width <= this.columnCount_) {
    // Current row does not need clipping, but may need clamping.
    if (this.curscol >= this.columnCount_) {
      this.setCursorPosition(this.cursrow, this.columnCount_ - 1);
      this.cursovrfl = 1;
    }

    return;
  }

  // Save off the current column so we can maybe restore it later.
  currentColumn = this.curscol;

  // Move the cursor to the final column.
  this.setCursorPosition(this.cursrow, this.columnCount_ - 1);

  // Remove any text that partially overflows.
  width = hterm.TextAttributes.nodeWidth(lib.notNull(this.cursorNode_));

  if (this.cursorOffset_ < width - 1) {
    this.cursorNode_.textContent = hterm.TextAttributes.nodeSubstr(
        this.cursorNode_, 0, this.cursorOffset_ + 1);
  }

  // Remove all nodes after the cursor.
  const rowNode = this.cursorRowNode_;
  let node = this.cursorNode_.nextSibling;

  while (node) {
    rowNode.removeChild(node);
    node = this.cursorNode_.nextSibling;
  }

  if (currentColumn < this.columnCount_) {
    // If the cursor was within the screen before we started then restore its
    // position.
    this.setCursorPosition(this.cursrow, currentColumn);
  } else {
    // Otherwise leave it at the the last column in the overflow state.
    this.cursovrfl = 1;
  }
};

/**
 * Insert a string at the current character position using the current
 * text attributes.
 *
 * You must call maybeClipCurrentRow() after in order to clip overflowed
 * text and clamp the cursor.
 *
 * It is also up to the caller to properly maintain the line overflow state
 * using hterm.Screen..commitLineOverflow().
 *
 * @param {string} str The string to insert.
 * @param {number=} wcwidth The cached lib.wc.strWidth value for |str|.  Will be
 *     calculated on demand if need be.  Passing in a cached value helps speed
 *     up processing as this is a hot codepath.
 */
hterm.Screen.prototype.insertString = function(str, wcwidth = undefined) {
  let cursorNode = this.cursorNode_;
  let cursorNodeText = cursorNode.textContent;

  this.cursorRowNode_.removeAttribute('line-overflow');

  // We may alter the width of the string by prepending some missing
  // whitespaces, so we need to record the string width ahead of time.
  if (wcwidth === undefined) {
    wcwidth = lib.wc.strWidth(str);
  }

  // No matter what, before this function exits the cursor column will have
  // moved this much.
  this.curscol += wcwidth;

  // Local cache of the cursor offset.
  let offset = this.cursorOffset_;

  // Reverse offset is the offset measured from the end of the string.
  // Zero implies that the cursor is at the end of the cursor node.
  let reverseOffset = hterm.TextAttributes.nodeWidth(cursorNode) - offset;

  if (reverseOffset < 0) {
    // A negative reverse offset means the cursor is positioned past the end
    // of the characters on this line.  We'll need to insert the missing
    // whitespace.
    const ws = ' '.repeat(-reverseOffset);

    // This whitespace should be completely unstyled.  Underline, background
    // color, and strikethrough would be visible on whitespace, so we can't use
    // one of those spans to hold the text.
    if (!(this.scrTextAttr.underline ||
          this.scrTextAttr.strikethrough ||
          this.scrTextAttr.background ||
          this.scrTextAttr.wcNode ||
          !this.scrTextAttr.asciiNode ||
          this.scrTextAttr.tileData != null)) {
      // Best case scenario, we can just pretend the spaces were part of the
      // original string.
      str = ws + str;
    } else if (cursorNode.nodeType == Node.TEXT_NODE ||
               !(cursorNode.wcNode ||
                 !cursorNode.asciiNode ||
                 cursorNode.tileNode ||
                 cursorNode.style.textDecoration ||
                 cursorNode.style.textDecorationStyle ||
                 cursorNode.style.textDecorationLine ||
                 cursorNode.style.backgroundColor)) {
      // Second best case, the current node is able to hold the whitespace.
      cursorNode.textContent = (cursorNodeText += ws);
    } else {
      // Worst case, we have to create a new node to hold the whitespace.
      const wsNode = cursorNode.ownerDocument.createTextNode(ws);
      this.cursorRowNode_.insertBefore(wsNode, cursorNode.nextSibling);
      this.cursorNode_ = cursorNode = wsNode;
      this.cursorOffset_ = offset = -reverseOffset;
      cursorNodeText = ws;
    }

    // We now know for sure that we're at the last character of the cursor node.
    reverseOffset = 0;
  }

  if (this.scrTextAttr.matchesContainer(cursorNode)) {
    // The new text can be placed directly in the cursor node.
    if (reverseOffset == 0) {
      cursorNode.textContent = cursorNodeText + str;
    } else if (offset == 0) {
      cursorNode.textContent = str + cursorNodeText;
    } else {
      cursorNode.textContent =
          hterm.TextAttributes.nodeSubstr(cursorNode, 0, offset) +
          str + hterm.TextAttributes.nodeSubstr(cursorNode, offset);
    }

    this.cursorOffset_ += wcwidth;
    return;
  }

  // The cursor node is the wrong style for the new text.  If we're at the
  // beginning or end of the cursor node, then the adjacent node is also a
  // potential candidate.

  if (offset == 0) {
    // At the beginning of the cursor node, the check the previous sibling.
    const previousSibling = cursorNode.previousSibling;
    if (previousSibling &&
        this.scrTextAttr.matchesContainer(previousSibling)) {
      previousSibling.textContent += str;
      this.cursorNode_ = previousSibling;
      this.cursorOffset_ = lib.wc.strWidth(previousSibling.textContent);
      return;
    }

    const newNode = this.scrTextAttr.createContainer(str);
    this.cursorRowNode_.insertBefore(newNode, cursorNode);
    this.cursorNode_ = newNode;
    this.cursorOffset_ = wcwidth;
    return;
  }

  if (reverseOffset == 0) {
    // At the end of the cursor node, the check the next sibling.
    const nextSibling = cursorNode.nextSibling;
    if (nextSibling &&
        this.scrTextAttr.matchesContainer(nextSibling)) {
      nextSibling.textContent = str + nextSibling.textContent;
      this.cursorNode_ = nextSibling;
      this.cursorOffset_ = lib.wc.strWidth(str);
      return;
    }

    const newNode = this.scrTextAttr.createContainer(str);
    this.cursorRowNode_.insertBefore(newNode, nextSibling);
    this.cursorNode_ = newNode;
    // We specifically need to include any missing whitespace here, since it's
    // going in a new node.
    this.cursorOffset_ = hterm.TextAttributes.nodeWidth(newNode);
    return;
  }

  // Worst case, we're somewhere in the middle of the cursor node.  We'll
  // have to split it into two nodes and insert our new container in between.
  this.splitNode_(cursorNode, offset);
  const newNode = this.scrTextAttr.createContainer(str);
  this.cursorRowNode_.insertBefore(newNode, cursorNode.nextSibling);
  this.cursorNode_ = newNode;
  this.cursorOffset_ = wcwidth;
};

/**
 * Overwrite the text at the current cursor position.
 *
 * You must call maybeClipCurrentRow() after in order to clip overflowed
 * text and clamp the cursor.
 *
 * It is also up to the caller to properly maintain the line overflow state
 * using hterm.Screen..commitLineOverflow().
 *
 * @param {string} str The source string for overwriting existing content.
 * @param {number=} wcwidth The cached lib.wc.strWidth value for |str|.  Will be
 *     calculated on demand if need be.  Passing in a cached value helps speed
 *     up processing as this is a hot codepath.
 */
hterm.Screen.prototype.overwriteString = function(str, wcwidth = undefined) {
  TMint maxLength = this.columnCount_ - this.curscol;
  if (!maxLength) {
    return;
  }

  if (wcwidth === undefined) {
    wcwidth = lib.wc.strWidth(str);
  }

  if (this.scrTextAttr.matchesContainer(lib.notNull(this.cursorNode_)) &&
      this.cursorNode_.textContent.substr(this.cursorOffset_) ==
          str) {
    // This overwrite would be a no-op, just move the cursor and return.
    this.cursorOffset_ += wcwidth;
    this.curscol += wcwidth;
    return;
  }

  this.deleteChars(Math.min(wcwidth, maxLength));
  this.insertString(str, wcwidth);
};

/**
 * Forward-delete one or more characters at the current cursor position.
 *
 * Text to the right of the deleted characters is shifted left.  Only affects
 * characters on the same row as the cursor.
 *
 * @param {number} count The column width of characters to delete.  This is
 *     clamped to the column width minus the cursor column.
 * @return {number} The column width of the characters actually deleted.
 */
hterm.Screen.prototype.deleteChars = function(count) {
  TMint currentCursorColumn;

  let node = this.cursorNode_;
  let offset = this.cursorOffset_;

  currentCursorColumn = this.curscol;
  count = Math.min(count, this.columnCount_ - currentCursorColumn);
  if (!count) {
    return 0;
  }

  const rv = count;
  let startLength, endLength;

  while (node && count) {
    // Check so we don't loop forever, but we don't also go quietly.
    if (count < 0) {
      console.error(`Deleting ${rv} chars went negative: ${count}`);
      break;
    }

    startLength = hterm.TextAttributes.nodeWidth(node);
    node.textContent = hterm.TextAttributes.nodeSubstr(node, 0, offset) +
        hterm.TextAttributes.nodeSubstr(node, offset + count);
    endLength = hterm.TextAttributes.nodeWidth(node);

    // Deal with splitting wide characters.  There are two ways: we could delete
    // the first column or the second column.  In both cases, we delete the wide
    // character and replace one of the columns with a space (since the other
    // was deleted).  If there are more chars to delete, the next loop will pick
    // up the slack.
    if (node.wcNode && offset < startLength &&
        ((endLength && startLength == endLength) ||
         (!endLength && offset == 1))) {
      // No characters were deleted when there should be.  We're probably trying
      // to delete one column width from a wide character node.  We remove the
      // wide character node here and replace it with a single space.
      const spaceNode = this.scrTextAttr.createContainer(' ');
      node.parentNode.insertBefore(spaceNode, offset ? node : node.nextSibling);
      node.textContent = '';
      endLength = 0;
      count -= 1;
    } else {
      count -= startLength - endLength;
    }

    const nextNode = node.nextSibling;
    if (endLength == 0 && node != this.cursorNode_) {
      node.remove();
    }
    node = nextNode;
    offset = 0;
  }

  // Remove this.cursorNode_ if it is an empty non-text node.
  if (this.cursorNode_.nodeType != Node.TEXT_NODE &&
      !this.cursorNode_.textContent) {
    const cursorNode = this.cursorNode_;
    if (cursorNode.previousSibling) {
      this.cursorNode_ = cursorNode.previousSibling;
      this.cursorOffset_ = hterm.TextAttributes.nodeWidth(
          cursorNode.previousSibling);
    } else if (cursorNode.nextSibling) {
      this.cursorNode_ = cursorNode.nextSibling;
      this.cursorOffset_ = 0;
    } else {
      const emptyNode = this.cursorRowNode_.ownerDocument.createTextNode('');
      this.cursorRowNode_.appendChild(emptyNode);
      this.cursorNode_ = emptyNode;
      this.cursorOffset_ = 0;
    }
    this.cursorRowNode_.removeChild(cursorNode);
  }

  return rv;
};

/**
 * Finds first X-ROW of a line containing specified X-ROW.
 * Used to support line overflow.
 *
 * @param {!Node} row X-ROW to begin search for first row of line.
 * @return {!Node} The X-ROW that is at the beginning of the line.
 **/
hterm.Screen.prototype.getLineStartRow_ = function(row) {
  while (row.previousSibling &&
         row.previousSibling.hasAttribute('line-overflow')) {
    row = row.previousSibling;
  }
  return row;
};

/**
 * Gets text of a line beginning with row.
 * Supports line overflow.
 *
 * @param {!Node} row First X-ROW of line.
 * @return {string} Text content of line.
 **/
hterm.Screen.prototype.getLineText_ = function(row) {
  let rowText = '';
  let rowOrNull = row;
  while (rowOrNull) {
    rowText += rowOrNull.textContent;
    if (rowOrNull.hasAttribute('line-overflow')) {
      rowOrNull = rowOrNull.nextSibling;
    } else {
      break;
    }
  }
  return rowText;
};

/**
 * Returns X-ROW that is ancestor of the node.
 *
 * @param {!Node} node Node to get X-ROW ancestor for.
 * @return {?Node} X-ROW ancestor of node, or null if not found.
 **/
hterm.Screen.prototype.getXRowAncestor_ = function(node) {
  let nodeOrNull = node;
  while (nodeOrNull) {
    if (nodeOrNull.nodeName === 'X-ROW') {
      break;
    }
    nodeOrNull = nodeOrNull.parentNode;
  }
  return nodeOrNull;
};

/**
 * Returns position within line of character at offset within node.
 * Supports line overflow.
 *
 * @param {!Node} row X-ROW at beginning of line.
 * @param {!Node} node Node to get position of.
 * @param {number} offset Offset into node.
 * @return {number} Position within line of character at offset within node.
 **/
hterm.Screen.prototype.getPositionWithOverflow_ = function(row, node, offset) {
  if (!node) {
    return -1;
  }
  const ancestorRow = this.getXRowAncestor_(node);
  if (!ancestorRow) {
    return -1;
  }
  let position = 0;
  while (ancestorRow != row) {
    position += hterm.TextAttributes.nodeWidth(row);
    if (row.hasAttribute('line-overflow') && row.nextSibling) {
      row = row.nextSibling;
    } else {
      return -1;
    }
  }
  return position + this.getPositionWithinRow_(row, node, offset);
};

/**
 * Returns position within row of character at offset within node.
 * Does not support line overflow.
 *
 * @param {!Node} row X-ROW to get position within.
 * @param {!Node} node Node to get position for.
 * @param {number} offset Offset within node to get position for.
 * @return {number} Position within row of character at offset within node.
 **/
hterm.Screen.prototype.getPositionWithinRow_ = function(row, node, offset) {
  if (node.parentNode != row) {
    // If we traversed to the top node, then there's nothing to find here.
    if (node.parentNode == null) {
      return -1;
    }

    return this.getPositionWithinRow_(node.parentNode, node, offset) +
           this.getPositionWithinRow_(row, node.parentNode, 0);
  }
  let position = 0;
  for (let i = 0; i < row.childNodes.length; i++) {
    const currentNode = row.childNodes[i];
    if (currentNode == node) {
      return position + offset;
    }
    position += hterm.TextAttributes.nodeWidth(currentNode);
  }
  return -1;
};

/**
 * Returns the node and offset corresponding to position within line.
 * Supports line overflow.
 *
 * @param {!Node} row X-ROW at beginning of line.
 * @param {number} position Position within line to retrieve node and offset.
 * @return {?Array} Two element array containing node and offset respectively.
 **/
hterm.Screen.prototype.getNodeAndOffsetWithOverflow_ = function(row, position) {
  while (row && position > hterm.TextAttributes.nodeWidth(row)) {
    if (row.hasAttribute('line-overflow') && row.nextSibling) {
      position -= hterm.TextAttributes.nodeWidth(row);
      row = row.nextSibling;
    } else {
      return [null, -1];
    }
  }
  return this.getNodeAndOffsetWithinRow_(row, position);
};

/**
 * Returns the node and offset corresponding to position within row.
 * Does not support line overflow.
 *
 * @param {!Node} row X-ROW to get position within.
 * @param {number} position Position within row to retrieve node and offset.
 * @return {?Array} Two element array containing node and offset respectively.
 **/
hterm.Screen.prototype.getNodeAndOffsetWithinRow_ = function(row, position) {
  for (let i = 0; i < row.childNodes.length; i++) {
    const node = row.childNodes[i];
    const nodeTextWidth = hterm.TextAttributes.nodeWidth(node);
    if (position <= nodeTextWidth) {
      if (node.nodeName === 'SPAN') {
        /** Drill down to node contained by SPAN. **/
        return this.getNodeAndOffsetWithinRow_(node, position);
      } else {
        return [node, position];
      }
    }
    position -= nodeTextWidth;
  }
  return null;
};

/**
 * Returns the node and offset corresponding to position within line.
 * Supports line overflow.
 *
 * @param {!Node} row X-ROW at beginning of line.
 * @param {number} start Start position of range within line.
 * @param {number} end End position of range within line.
 * @param {!Range} range Range to modify.
 **/
hterm.Screen.prototype.setRange_ = function(row, start, end, range) {
  const startNodeAndOffset = this.getNodeAndOffsetWithOverflow_(row, start);
  if (startNodeAndOffset == null) {
    return;
  }
  const endNodeAndOffset = this.getNodeAndOffsetWithOverflow_(row, end);
  if (endNodeAndOffset == null) {
    return;
  }
  range.setStart(startNodeAndOffset[0], startNodeAndOffset[1]);
  range.setEnd(endNodeAndOffset[0], endNodeAndOffset[1]);
};

/**
 * Expands selection to surrounding string with word break matches.
 *
 * @param {?Selection} selection Selection to expand.
 * @param {string} leftMatch left word break match.
 * @param {string} rightMatch right word break match.
 * @param {string} insideMatch inside word break match.
 */
hterm.Screen.prototype.expandSelectionWithWordBreakMatches_ =
    function(selection, leftMatch, rightMatch, insideMatch) {
  if (!selection) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!range || range.toString().match(/\s/)) {
    return;
  }

  const rowElement = this.getXRowAncestor_(lib.notNull(range.startContainer));
  if (!rowElement) {
    return;
  }
  const row = this.getLineStartRow_(rowElement);
  if (!row) {
    return;
  }

  const startPosition = this.getPositionWithOverflow_(
      row, lib.notNull(range.startContainer), range.startOffset);
  if (startPosition == -1) {
    return;
  }
  const endPosition = this.getPositionWithOverflow_(
      row, lib.notNull(range.endContainer), range.endOffset);
  if (endPosition == -1) {
    return;
  }

  // Move start to the left.
  const rowText = this.getLineText_(row);
  const lineUpToRange = lib.wc.substring(rowText, 0, endPosition);
  const leftRegularExpression = new RegExp(leftMatch + insideMatch + '$');
  const expandedStart = lineUpToRange.search(leftRegularExpression);
  if (expandedStart == -1 || expandedStart > startPosition) {
    return;
  }

  // Move end to the right.
  const lineFromRange = lib.wc.substring(rowText, startPosition,
                                         lib.wc.strWidth(rowText));
  const rightRegularExpression = new RegExp('^' + insideMatch + rightMatch);
  const found = lineFromRange.match(rightRegularExpression);
  if (!found) {
    return;
  }
  const expandedEnd = startPosition + lib.wc.strWidth(found[0]);
  if (expandedEnd == -1 || expandedEnd < endPosition) {
    return;
  }

  this.setRange_(row, expandedStart, expandedEnd, range);
  selection.addRange(range);
};

/**
 * Expands selection to surrounding string using the user's settings.
 *
 * @param {?Selection} selection Selection to expand.
 */
hterm.Screen.prototype.expandSelection = function(selection) {
  this.expandSelectionWithWordBreakMatches_(
      selection,
      lib.notNull(wordBreakMatchLeft),
      lib.notNull(wordBreakMatchRight),
      lib.notNull(wordBreakMatchMiddle));
};

/**
 * Expands selection to surrounding URL using a set of fixed match settings.
 *
 * @param {?Selection} selection Selection to expand.
 */
hterm.Screen.prototype.expandSelectionForUrl = function(selection) {
  this.expandSelectionWithWordBreakMatches_(
      selection,
      '[^\\s[\\](){}<>"\'^!@#$%&*,;:`\u{2018}\u{201c}\u{2039}\u{ab}]',
      '[^\\s[\\](){}<>"\'^!@#$%&*,;:~.`\u{2019}\u{201d}\u{203a}\u{bb}]',
      '[^\\s[\\](){}<>"\'^]*');
};

/**
 * Save the current cursor state to the corresponding screens.
 *
 * @param {!hterm.VT} vt The VT object to read graphic codeset details from.
 */
hterm.Screen.prototype.saveCursorAndState = function(vt) {
  this.cursorState_.save(vt);
};

/**
 * Restore the saved cursor state in the corresponding screens.
 *
 * @param {!hterm.VT} vt The VT object to write graphic codeset details to.
 */
hterm.Screen.prototype.restoreCursorAndState = function(vt) {
  this.cursorState_.restore(vt);
};

/**
 * Track all the things related to the current "cursor".
 *
 * The set of things saved & restored here is defined by DEC:
 * https://vt100.net/docs/vt510-rm/DECSC.html
 * - Cursor position
 * - Character attributes set by the SGR command
 * - Character sets (G0, G1, G2, or G3) currently in GL and GR
 * - Wrap flag (autowrap or no autowrap)
 * - State of origin mode (DECOM)
 * - Selective erase attribute
 * - Any single shift 2 (SS2) or single shift 3 (SS3) functions sent
 *
 * These are done on a per-screen basis.
 *
 * @param {!hterm.Screen} screen The screen this cursor is tied to.
 * @constructor
 */
hterm.Screen_CursorState = function(screen) {
  this.screen_ = screen;
  this.cursor = null;
  this.textAttributes = null;
  this.GL = this.GR = this.G0 = this.G1 = this.G2 = this.G3 = null;
};

/**
 * Save all the cursor state.
 *
 * @param {!hterm.VT} vt The VT object to read graphic codeset details from.
 */
hterm.Screen_CursorState.prototype.save = function(vt) {
  this.cursor = vt.terminal.saveCursor();

  this.textAttributes = this.screen_.scrTextAttr.clone();

  this.GL = vt.GL;
  this.GR = vt.GR;

  this.G0 = vt.G0;
  this.G1 = vt.G1;
  this.G2 = vt.G2;
  this.G3 = vt.G3;
};

/**
 * Restore the previously saved cursor state.
 *
 * @param {!hterm.VT} vt The VT object to write graphic codeset details to.
 */
hterm.Screen_CursorState.prototype.restore = function(vt) {
  vt.terminal.restoreCursor(this.cursor);

  // Cursor restore includes char attributes (bold/etc...), but does not change
  // the color palette (which are a terminal setting).
  const tattrs = this.textAttributes.clone();
  tattrs.colorPaletteOverrides =
      this.screen_.scrTextAttr.colorPaletteOverrides;
  tattrs.syncColors();

  this.screen_.scrTextAttr = tattrs;

  vt.GL = this.GL;
  vt.GR = this.GR;

  vt.G0 = this.G0;
  vt.G1 = this.G1;
  vt.G2 = this.G2;
  vt.G3 = this.G3;
};
// SOURCE FILE: hterm/js/hterm_scrollport.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * The Vportctx should return rows rooted by the custom tag name 'x-row'.
 * This ensures that we can quickly assign the correct display height
 * to the rows with css.
 *
 * @interface
 */
hterm.Vportctx = function() {};

/**
 * @abstract
 * @return {number} The current number of rows.
 */
hterm.Vportctx.prototype.getRowCount = function() {};

/**
 * Get specified row.
 *
 * @abstract
 * @param {number} index The index of the row.
 * @return {!Element}
 */
hterm.Vportctx.prototype.getRowNode = function(index) {};

hterm.Vportctx.prototype.getCssVar = function(name) {};

/**
 * A 'viewport' view of fixed-height rows with support for selection and
 * copy-to-clipboard.
 *
 * 'Viewport' in this case means that only the visible rows are in the DOM.
 * If the vportctx has 100,000 rows, but the ScrollPort is only 25 rows
 * tall, then only 25 dom nodes are created.  The ScrollPort will ask the
 * Vportctx to create new visible rows on demand as they are scrolled in
 * to the visible area.
 *
 * This viewport is designed so that select and copy-to-clipboard still works,
 * even when all or part of the selection is scrolled off screen.
 *
 * Note that the X11 mouse clipboard does not work properly when all or part
 * of the selection is off screen.  It would be difficult to fix this without
 * adding significant overhead to pathologically large selection cases.
 *
 * @param {!hterm.Vportctx} vportctx An object capable of providing rows
 *     as raw text or row nodes.
 * @constructor
 * @extends {hterm.PubSub}
 */
hterm.ScrollPort = function(vportctx) {
  hterm.PubSub.addBehavior(this);

  this.vportctx_ = vportctx;

  // SWAG the character size until we can measure it.
  this.characterSize = {width: 10, height: 10};

  this.selection = new hterm.ScrollPort.Selection(this);

  // A map of rowIndex => rowNode for each row that is drawn as part of a
  // pending redraw_() call.  Null if there is no pending redraw_ call.
  this.currentRowNodeCache_ = null;

  // A map of rowIndex => rowNode for each row that was drawn as part of the
  // previous redraw_() call.
  this.previousRowNodeCache_ = {};

  // Used during scroll events to detect when the underlying cause is a resize.
  this.lastScreenWidth_ = 0;
  this.lastScreenHeight_ = 0;

  // True if the user should be allowed to select text in the terminal.
  // This is disabled when the host requests mouse drag events so that we don't
  // end up with two notions of selection.
  this.selectionEnabled_ = true;

  // The last row count returned by the vportctx, re-populated during
  // syncScrollHeight().
  this.lastRowCount_ = 0;

  // The scroll wheel pixel delta multiplier to increase/decrease
  // the scroll speed of mouse wheel events. See: https://goo.gl/sXelnq
  this.scrollWheelMultiplier_ = 1;

  // The last touch events we saw to support touch based scrolling.  Indexed
  // by touch identifier since we can have more than one touch active.
  this.lastTouch_ = {};

  /**
   * Size of screen padding in pixels.
   */
  this.screenPaddingSize = 0;

  /**
   * Whether to paste on dropped text.
   */
  this.pasteOnDrop = true;

  this.div_ = null;
  this.document_ = null;
  /** @type {?Element} */
  this.x_screen = null;
  this.scroll_top = 0;

  // Collection of active timeout handles.
  this.timeouts_ = {};

  this.observers_ = {};

  // Offscreen selection rows that are set with 'aria-hidden'.
  // They must be unset when selection changes or the rows are visible.
  this.ariaHiddenSelectionRows_ = [];

  this.DEBUG_ = false;
};

hterm.ScrollPort.prototype.physpixdim = function(el) {
	var r, f;

	r = el.getBoundingClientRect();
	f = this.vportctx_.getCssVar('dpi-fudge') || 1;

	return {
		width:	r.width / f,
		height:	r.height / f,
	};
};

/**
 * Proxy for the native selection object which understands how to walk up the
 * DOM to find the containing row node and sort out which comes first.
 *
 * @param {!hterm.ScrollPort} scrollPort The parent hterm.ScrollPort instance.
 * @constructor
 */
hterm.ScrollPort.Selection = function(scrollPort) {
  this.scroll_port = scrollPort;

  /**
   * The row containing the start of the selection.
   *
   * This may be partially or fully selected.  It may be the selection anchor
   * or the focus, but its rowIndex is guaranteed to be less-than-or-equal-to
   * that of the endRow.
   *
   * If only one row is selected then startRow == endRow.  If there is no
   * selection or the selection is collapsed then startRow == null.
   *
   * @type {?Node}
   */
  this.startRow = null;

  /**
   * Node where selection starts.
   *
   * @type {?Node}
   */
  this.startNode = null;

  /**
   * Character offset in startNode where selection starts.
   *
   * @type {number}
   */
  this.startOffset = 0;

  /**
   * The row containing the end of the selection.
   *
   * This may be partially or fully selected.  It may be the selection anchor
   * or the focus, but its rowIndex is guaranteed to be greater-than-or-equal-to
   * that of the startRow.
   *
   * If only one row is selected then startRow == endRow.  If there is no
   * selection or the selection is collapsed then startRow == null.
   *
   * @type {?Node}
   */
  this.endRow = null;

  /**
   * Node where selection ends.
   *
   * @type {?Node}
   */
  this.endNode = null;

  /**
   * Character offset in endNode where selection ends.
   *
   * @type {number}
   */
  this.endOffset = 0;

  /**
   * True if startRow != endRow.
   *
   * @type {boolean}
   */
  this.isMultiline = false;

  /**
   * True if the selection is just a point (empty) rather than a range.
   *
   * @type {boolean}
   */
  this.isCollapsed = true;
};

/**
 * Given a list of DOM nodes and a container, return the DOM node that
 * is first according to a depth-first search.
 *
 * @param {!Node} parent
 * @param {!Array<!Node>} childAry
 * @return {?Node} Returns null if none of the children are found.
 */
hterm.ScrollPort.Selection.prototype.findFirstChild = function(
    parent, childAry) {
  let node = parent.firstChild;

  while (node) {
    if (childAry.indexOf(node) != -1) {
      return node;
    }

    if (node.childNodes.length) {
      const rv = this.findFirstChild(node, childAry);
      if (rv) {
        return rv;
      }
    }

    node = node.nextSibling;
  }

  return null;
};

/**
 * Synchronize this object with the current DOM selection.
 *
 * This is a one-way synchronization, the DOM selection is copied to this
 * object, not the other way around.
 */
hterm.ScrollPort.Selection.prototype.sync = function() {
  // The dom selection object has no way to tell which nodes come first in
  // the document, so we have to figure that out.
  //
  // This function is used when we detect that the "anchor" node is first.
  const anchorFirst = () => {
    this.startRow = anchorRow;
    this.startNode = selection.anchorNode;
    this.startOffset = selection.anchorOffset;
    this.endRow = focusRow;
    this.endNode = focusNode;
    this.endOffset = focusOffset;
  };

  // This function is used when we detect that the "focus" node is first.
  const focusFirst = () => {
    this.startRow = focusRow;
    this.startNode = focusNode;
    this.startOffset = focusOffset;
    this.endRow = anchorRow;
    this.endNode = selection.anchorNode;
    this.endOffset = selection.anchorOffset;
  };

  const selection = this.scroll_port.getDocument().getSelection();

  const clear = () => {
    this.startRow = null;
    this.startNode = null;
    this.startOffset = 0;
    this.endRow = null;
    this.endNode = null;
    this.endOffset = 0;
    this.isMultiline = false;
    this.isCollapsed = true;
  };

  if (!selection) {
    clear();
    return;
  }

  // Do not ignore collapsed selections. They must not be cleared.
  // Screen readers will set them as they navigate through the DOM.
  // Auto scroll can also create them as the selection inverts if you scroll
  // one way and then reverse direction.
  this.isCollapsed = !selection || selection.isCollapsed;

  let anchorRow = selection.anchorNode;
  while (anchorRow && anchorRow.nodeName != 'X-ROW') {
    anchorRow = anchorRow.parentNode;
  }

  if (!anchorRow) {
    // Don't set a selection if it's not a row node that's selected.
    clear();
    return;
  }

  let focusRow = selection.focusNode;
  let focusNode = focusRow;
  let focusOffset = selection.focusOffset;
  const focusIsStartOfTopRow = () => {
    focusRow = this.scroll_port.topFold_.nextSibling;
    focusNode = focusRow;
    focusOffset = 0;
  };
  const focusIsEndOfBottomRow = () => {
    focusRow = this.scroll_port.bottomFold_.previousSibling;
    focusNode = focusRow;
    while (focusNode.lastChild) {
      focusNode = focusNode.lastChild;
    }
    focusOffset = focusNode.length || 0;
  };

  // If focus is topFold or bottomFold, use adjacent row.
  if (focusRow === this.scroll_port.topFold_) {
    focusIsStartOfTopRow();
  } else if (focusRow === this.scroll_port.bottomFold_) {
    focusIsEndOfBottomRow();
  }

  while (focusRow && focusRow.nodeName != 'X-ROW') {
    focusRow = focusRow.parentNode;
  }

  if (!focusRow) {
    // Keep existing selection (do not clear()) if focus is not a valid row.
    return;
  }

  if (anchorRow.rowIndex < focusRow.rowIndex) {
    anchorFirst();

  } else if (anchorRow.rowIndex > focusRow.rowIndex) {
    focusFirst();

  } else if (focusNode == selection.anchorNode) {
    if (selection.anchorOffset < focusOffset) {
      anchorFirst();
    } else {
      focusFirst();
    }

  } else {
    // The selection starts and ends in the same row, but isn't contained all
    // in a single node.
    const firstNode = this.findFirstChild(
        anchorRow, [selection.anchorNode, focusNode]);

    if (!firstNode) {
      throw new Error('Unexpected error syncing selection.');
    }

    if (firstNode == selection.anchorNode) {
      anchorFirst();
    } else {
      focusFirst();
    }
  }

  this.isMultiline = anchorRow.rowIndex != focusRow.rowIndex;
};

/**
 * Turn a div into this hterm.ScrollPort.
 *
 * @param {!Element} div
 * @param {function()=} callback
 */
hterm.ScrollPort.prototype.decorate = function(div, callback) {
  this.div_ = div;

  this.iframe_ = div.ownerDocument.createElement('iframe');
  this.iframe_.style.cssText = (
      'border: 0;' +
      'height: 100%;' +
      'position: absolute;' +
      'width: 100%');

  div.appendChild(this.iframe_);

  const onLoad = () => {
    this.paintIframeContents_();
    if (callback) {
      callback();
    }
  };

  // Insert Iframe content asynchronously in FF.  Otherwise when the frame's
  // load event fires in FF it clears out the content of the iframe.
  if ('mozInnerScreenX' in window) { // detect a FF only property
    this.iframe_.addEventListener('load', () => onLoad());
  } else {
    onLoad();
  }
};


/**
 * Initialises the content of this.iframe_. This needs to be done asynchronously
 * in FF after the Iframe's load event has fired.
 *
 * @private
 */
hterm.ScrollPort.prototype.paintIframeContents_ = function() {
  var xs;

  this.iframe_.contentWindow.addEventListener('resize',
                                              this.resize.bind(this));

  const doc = this.document_ = this.iframe_.contentDocument;
  doc.body.style.cssText = (
      'margin: 0px;' +
      'padding: 0px;' +
      'height: 100%;' +
      'width: 100%;' +
      'overflow: hidden;' +
      'cursor: var(--hterm-mouse-cursor-style);' +
      'user-select: none;');

  const metaCharset = doc.createElement('meta');
  metaCharset.setAttribute('charset', 'utf-8');
  doc.head.appendChild(metaCharset);

  if (this.DEBUG_) {
    // When we're debugging we add padding to the body so that the offscreen
    // elements are visible.
    this.document_.body.style.paddingTop =
        this.document_.body.style.paddingBottom =
        'calc(var(--hterm-charsize-height) * 3)';
  }

  const style = doc.createElement('style');
  style.textContent = (
      'x-row {' +
      '  display: block;' +
      '  height: var(--hterm-charsize-height);' +
      '  line-height: var(--hterm-charsize-height);' +
      '}');
  doc.head.appendChild(style);

  this.userCssLink_ = doc.createElement('link');
  this.userCssLink_.setAttribute('rel', 'stylesheet');

  xs = this.x_screen = doc.createElement('x-screen');
  doc.body.onfocus = function() {
    // x-screen's parent <body> was focused, which may mean the user
    // Tab'd into the terminal area. Focus the x-screen itself to make the
    // cursor have the right style (just a known example of possible problems).
    xs.focus();
  };
  // Prevent IME and autocorrect functionality from doing anything.
  // Some of these attributes are standard while others are browser specific,
  // but should be safely ignored by other browsers.
  // To enable IMEs, contenteditable would be true, the others would still be
  // turned off, and more work by the hterm calling code may have to be done.
  this.x_screen.setAttribute('contenteditable', 'false');
  this.x_screen.setAttribute('spellcheck', 'false');
  this.x_screen.setAttribute('autocomplete', 'off');
  this.x_screen.setAttribute('autocorrect', 'off');
  this.x_screen.setAttribute('autocapitalize', 'none');

  // In some ways the terminal behaves like a text box but not in all ways. It
  // is not editable in the same ways a text box is editable and the content we
  // want to be read out by a screen reader does not always align with the edits
  // (selection changes) that happen in the terminal window. Use the log role so
  // that the screen reader doesn't treat it like a text box and announce all
  // selection changes. The announcements that we want spoken are generated
  // by a separate live region, which gives more control over what will be
  // spoken.
  this.x_screen.setAttribute('role', 'log');
  this.x_screen.setAttribute('aria-live', 'off');
  this.x_screen.setAttribute('aria-roledescription', 'Terminal');

  // Set aria-readonly to indicate to the screen reader that the text on the
  // screen is not modifiable by the html cursor. It may be modifiable by
  // sending input to the application running in the terminal, but this is
  // orthogonal to the DOM's notion of modifiable.
  this.x_screen.setAttribute('aria-readonly', 'true');
  this.x_screen.setAttribute('tabindex', '-1');
  this.x_screen.style.cssText = `
      background-color: rgb(var(--hterm-background-color));
      caret-color: transparent;
      color: rgb(var(--hterm-foreground-color));
      display: block;
      font-variant-ligatures: none;
      height: 100%;
      overflow-y: scroll; overflow-x: hidden;
      white-space: pre;
      width: 100%;
      outline: none !important;
  `;


  /**
   * @param {function(...)} f
   * @return {!EventListener}
   */
  const el = (f) => /** @type {!EventListener} */ (f);
  this.x_screen.addEventListener('scroll', el(this.onScroll_.bind(this)));
  this.x_screen.addEventListener('wheel', el(this.onScrollWheel_.bind(this)));
  this.x_screen.addEventListener('copy', el(this.onCopy_.bind(this)));
  this.x_screen.addEventListener('paste', el(this.onPaste_.bind(this)));
  this.x_screen.addEventListener('drop', el(this.onDragAndDrop_.bind(this)));

  // Add buttons to make accessible scrolling through terminal history work
  // well. These are positioned off-screen until they are selected, at which
  // point they are moved on-screen.
  const a11yButtonHeight = 30;
  const a11yButtonBorder = 1;
  const a11yButtonTotalHeight = a11yButtonHeight + 2 * a11yButtonBorder;
  const a11yButtonStyle = `
    border-style: solid;
    border-width: ${a11yButtonBorder}px;
    color: rgb(var(--hterm-foreground-color));
    cursor: pointer;
    font-family: monospace;
    font-weight: bold;
    height: ${a11yButtonHeight}px;
    line-height: ${a11yButtonHeight}px;
    padding: 0 8px;
    position: fixed;
    right: var(--hterm-screen-padding-size);
    text-align: center;
    z-index: 1;
  `;
  // Note: we use a <div> rather than a <button> because we don't want it to be
  // focusable. If it's focusable this interferes with the contenteditable
  // focus.
  this.scrollUpButton_ = this.document_.createElement('div');
  this.scrollUpButton_.id = 'hterm:a11y:page-up';
  this.scrollUpButton_.innerText = '^';
  this.scrollUpButton_.setAttribute('role', 'button');
  this.scrollUpButton_.style.cssText = a11yButtonStyle;
  this.scrollUpButton_.style.top = `${-a11yButtonTotalHeight}px`;

  this.scrollDownButton_ = this.document_.createElement('div');
  this.scrollDownButton_.id = 'hterm:a11y:page-down';
  this.scrollDownButton_.innerText = 'v';
  this.scrollDownButton_.setAttribute('role', 'button');
  this.scrollDownButton_.style.cssText = a11yButtonStyle;
  this.scrollDownButton_.style.bottom = `${-a11yButtonTotalHeight}px`;

  this.optionsButton_ = this.document_.createElement('div');
  this.optionsButton_.id = 'hterm:a11y:options';
  this.optionsButton_.innerText = hterm.msg('OPTIONS_BUTTON_LABEL', [], 'Options');
  this.optionsButton_.setAttribute('role', 'button');
  this.optionsButton_.style.cssText = a11yButtonStyle;
  this.optionsButton_.style.bottom = `${-2 * a11yButtonTotalHeight}px`;
  this.optionsButton_.addEventListener(
      'click', this.publish.bind(this, 'options'));

  doc.body.appendChild(this.scrollUpButton_);
  doc.body.appendChild(this.x_screen);
  doc.body.appendChild(this.scrollDownButton_);
  doc.body.appendChild(this.optionsButton_);

  // We only allow the scroll buttons to display after a delay, otherwise the
  // page up button can flash onto the screen during the intial change in focus.
  // This seems to be because it is the first element inside the <x-screen>
  // element, which will get focussed on page load.
  this.allowA11yButtonsToDisplay_ = false;
  setTimeout(() => { this.allowA11yButtonsToDisplay_ = true; }, 500);
  this.document_.addEventListener('selectionchange', () => {
    this.selection.sync();

    if (!this.allowA11yButtonsToDisplay_) {
      return;
    }

    const accessibilityEnabled = this.accessibilityReader_ &&
        this.accessibilityReader_.accessibilityEnabled;

    const selection = this.document_.getSelection();
    let selectedElement;
    if (selection.anchorNode && selection.anchorNode.parentElement) {
      selectedElement = selection.anchorNode.parentElement;
    }
    if (accessibilityEnabled && selectedElement == this.scrollUpButton_) {
      this.scrollUpButton_.style.top = `${this.screenPaddingSize}px`;
    } else {
      this.scrollUpButton_.style.top = `${-a11yButtonTotalHeight}px`;
    }
    if (accessibilityEnabled && selectedElement == this.scrollDownButton_) {
      this.scrollDownButton_.style.bottom = `${this.screenPaddingSize}px`;
    } else {
      this.scrollDownButton_.style.bottom = `${-a11yButtonTotalHeight}px`;
    }
    if (accessibilityEnabled && selectedElement == this.optionsButton_) {
      this.optionsButton_.style.bottom = `${this.screenPaddingSize}px`;
    } else {
      this.optionsButton_.style.bottom = `${-2 * a11yButtonTotalHeight}px`;
    }
  });

  // This is the main container for the fixed rows.
  this.rowNodes_ = doc.createElement('div');
  this.rowNodes_.id = 'hterm:row-nodes';
  this.rowNodes_.style.cssText = (
      'display: block;' +
      'position: fixed;' +
      'overflow: hidden;' +
      'user-select: text;');
  this.x_screen.appendChild(this.rowNodes_);

  // Two nodes to hold offscreen text during the copy event.
  this.topSelectBag_ = doc.createElement('x-select-bag');
  this.topSelectBag_.style.cssText = (
      'display: block;' +
      'overflow: hidden;' +
      'height: var(--hterm-charsize-height);' +
      'white-space: pre;');

  this.bottomSelectBag_ = this.topSelectBag_.cloneNode();

  // Nodes above the top fold and below the bottom fold are hidden.  They are
  // only used to hold rows that are part of the selection but are currently
  // scrolled off the top or bottom of the visible range.
  this.topFold_ = doc.createElement('x-fold');
  this.topFold_.id = 'hterm:top-fold-for-row-selection';
  this.topFold_.style.cssText = `
    display: block;
    height: var(--hterm-screen-padding-size);
  `;
  this.rowNodes_.appendChild(this.topFold_);

  this.bottomFold_ = this.topFold_.cloneNode();
  this.bottomFold_.id = 'hterm:bottom-fold-for-row-selection';
  this.rowNodes_.appendChild(this.bottomFold_);

  // This hidden div accounts for the vertical space that would be consumed by
  // all the rows in the buffer if they were visible.  It's what causes the
  // scrollbar to appear on the 'x-screen', and it moves within the screen when
  // the scrollbar is moved.
  //
  // It is set 'visibility: hidden' to keep the browser from trying to include
  // it in the selection when a user 'drag selects' upwards (drag the mouse to
  // select and scroll at the same time).  Without this, the selection gets
  // out of whack.
  this.scrollHeight_ = 0;

  // We send focus to this element just before a paste happens, so we can
  // capture the pasted text and forward it on to someone who cares.
  this.pasteTarget_ = doc.createElement('textarea');
  this.pasteTarget_.id = 'hterm:ctrl-v-paste-target';
  this.pasteTarget_.setAttribute('tabindex', '-1');
  this.pasteTarget_.setAttribute('aria-hidden', 'true');
  this.pasteTarget_.style.cssText = (
    'position: absolute;' +
    'height: 1px;' +
    'width: 1px;' +
    'left: 0px; ' +
    'bottom: 0px;' +
    'opacity: 0');
  this.pasteTarget_.contentEditable = true;

  this.x_screen.appendChild(this.pasteTarget_);
  this.pasteTarget_.addEventListener(
      'textInput', this.handlePasteTargetTextInput_.bind(this));

  this.resize();
};

/**
 * Set the AccessibilityReader object to use to announce page scroll updates.
 *
 * @param {!hterm.AccessibilityReader} accessibilityReader for announcing page
 *     scroll updates.
 */
hterm.ScrollPort.prototype.setAccessibilityReader =
    function(accessibilityReader) {
  this.accessibilityReader_ = accessibilityReader;
};

/** @return {string} */
hterm.ScrollPort.prototype.getFontFamily = function() {
  return this.x_screen.style.fontFamily;
};

/** Focus. */
hterm.ScrollPort.prototype.focus = function() {
  this.iframe_.focus();
  this.x_screen.focus();
  this.publish('focus');
};

/**
 * Unfocus the scrollport.
 */
hterm.ScrollPort.prototype.blur = function() {
  this.x_screen.blur();
};

/** @param {string} size */
hterm.ScrollPort.prototype.setBackgroundSize = function(size) {
  this.x_screen.style.backgroundSize = size;
};

/** @param {string} position */
hterm.ScrollPort.prototype.setBackgroundPosition = function(position) {
  this.x_screen.style.backgroundPosition = position;
};

/** @param {number} size */
hterm.ScrollPort.prototype.setScreenPaddingSize = function(size) {
  this.screenPaddingSize = size;
  this.resize();
};

/**
 * Get the usable size of the scrollport screen.
 *
 * @return {{height: number, width: number}}
 */
hterm.ScrollPort.prototype.getScreenSize = function() {
  const size = this.physpixdim(this.x_screen);
  const rightPadding = this.screenPaddingSize;
  return {
    height: size.height - (2 * this.screenPaddingSize),
    width: size.width - this.screenPaddingSize - rightPadding,
  };
};

/**
 * Return the document that holds the visible rows of this hterm.ScrollPort.
 *
 * @return {!Document}
 */
hterm.ScrollPort.prototype.getDocument = function() {
  return this.document_;
};

/**
 * Returns the x-screen element that holds the rows of this hterm.ScrollPort.
 *
 * @return {?Element}
 */
hterm.ScrollPort.prototype.getScreenNode = function() {
  return this.x_screen;
};

/**
 * Clear out any cached rowNodes.
 */
hterm.ScrollPort.prototype.resetCache = function() {
  this.currentRowNodeCache_ = null;
  this.previousRowNodeCache_ = {};
};

/**
 * Inform the ScrollPort that the root DOM nodes for some or all of the visible
 * rows are no longer valid.
 *
 * Specifically, this should be called if this.vportctx_.getRowNode() now
 * returns an entirely different node than it did before.  It does not
 * need to be called if the content of a row node is the only thing that
 * changed.
 *
 * This skips some of the overhead of a full redraw, but should not be used
 * in cases where the scrollport has been scrolled, or when the row count has
 * changed.
 */
hterm.ScrollPort.prototype.invalidate = function() {
  let node = this.topFold_.nextSibling;
  while (node != this.bottomFold_) {
    const nextSibling = node.nextSibling;
    node.remove();
    node = nextSibling;
  }

  this.previousRowNodeCache_ = null;
  const topRowIndex = this.getTopRowIndex();
  const bottomRowIndex = this.getBottomRowIndex(topRowIndex);

  this.drawVisibleRows_(topRowIndex, bottomRowIndex);
};

/**
 * Schedule invalidate.
 */
hterm.ScrollPort.prototype.scheduleInvalidate = function() {
  if (this.timeouts_.invalidate) {
    return;
  }

  this.timeouts_.invalidate = setTimeout(() => {
    delete this.timeouts_.invalidate;
    this.invalidate();
  });
};

/**
 * Return the current font size of the ScrollPort.
 *
 * @return {number}
 */
hterm.ScrollPort.prototype.getFontSize = function() {
  return parseInt(this.x_screen.style.fontSize, 10);
};

/**
 * Reset dimensions and visible row count to account for a change in the
 * dimensions of the 'x-screen'.
 */
hterm.ScrollPort.prototype.resize = function() {
  this.syncScrollHeight();
  this.syncRowNodesDimensions_();

  this.publish(
      'resize', {scrollPort: this},
      () => this.scheduleRedraw());
};

/**
 * Announce text content on the current screen for the screen reader.
 */
hterm.ScrollPort.prototype.assertiveAnnounce_ = function() {
  if (!this.accessibilityReader_) {
    return;
  }

  const topRow = this.getTopRowIndex();
  const bottomRow = this.getBottomRowIndex(topRow);

  let percentScrolled = 100 * topRow /
      Math.max(1, this.vportctx_.getRowCount() - this.visibleRowCount);
  percentScrolled = Math.min(100, Math.round(percentScrolled));
  let currentScreenContent = hterm.msg('ANNOUNCE_CURRENT_SCREEN_HEADER',
                                       [percentScrolled],
                                       '$1% scrolled,');
  currentScreenContent += '\n';

  for (let i = topRow; i <= bottomRow; ++i) {
    const node = this.fetchRowNode_(i);
    currentScreenContent += node.textContent + '\n';
  }

  this.accessibilityReader_.assertiveAnnounce(currentScreenContent);
};

/**
 * Set the position and size of the row nodes element.
 */
hterm.ScrollPort.prototype.syncRowNodesDimensions_ = function() {
  const screenSize = this.getScreenSize();

  this.lastScreenWidth_ = screenSize.width;
  this.lastScreenHeight_ = screenSize.height;

  // We don't want to show a partial row because it would be distracting
  // in a terminal, so we floor any fractional row count.
  this.visibleRowCount = lib.f.smartFloorDivide(
      screenSize.height, this.characterSize.height);

  // Then compute the height of our integral number of rows.
  this.visibleRowsHeight = this.visibleRowCount * this.characterSize.height;

  // Then the difference between the screen height and total row height needs to
  // be made up for as top margin.  We need to record this value so it
  // can be used later to determine the topRowIndex.
  this.visibleRowTopMargin = 0;
  this.visibleRowBottomMargin = screenSize.height - this.visibleRowsHeight;

  this.topFold_.style.marginBottom = dpifud(this.visibleRowTopMargin);


  let topFoldOffset = 0;
  let node = this.topFold_.previousSibling;
  while (node) {
    topFoldOffset += this.physpixdim(node).height;
    node = node.previousSibling;
  }

  // Set the dimensions of the visible rows container.
  this.rowNodes_.style.width = dpifud(screenSize.width);
  this.rowNodes_.style.height =
      dpifud(this.visibleRowsHeight + topFoldOffset + this.screenPaddingSize);
  this.rowNodes_.style.left =
      dpifud(this.x_screen.offsetLeft + this.screenPaddingSize);
  this.rowNodes_.style.top =
      dpifud(this.x_screen.offsetTop - topFoldOffset);
};

/**
 * Resize the scroll area to appear as though it contains every row.
 */
hterm.ScrollPort.prototype.syncScrollHeight = function() {
  this.lastRowCount_ = this.vportctx_.getRowCount();
  this.scrollHeight_ = (this.characterSize.height *
                        this.lastRowCount_ +
                        (2 * this.screenPaddingSize) +
                        this.visibleRowTopMargin +
                        this.visibleRowBottomMargin);
};

/**
 * Schedule a redraw to happen asynchronously.
 *
 * If this method is called multiple times before the redraw has a chance to
 * run only one redraw occurs.
 */
hterm.ScrollPort.prototype.scheduleRedraw = function() {
  if (this.timeouts_.redraw) {
    return;
  }

  this.timeouts_.redraw = setTimeout(() => {
    delete this.timeouts_.redraw;
    this.redraw_();
  });
};

/**
 * Update the state of scroll up/down buttons.
 *
 * If the viewport is at the top or bottom row of output, these buttons will
 * be made transparent and clicking them shouldn't scroll any further.
 */
hterm.ScrollPort.prototype.updateScrollButtonState_ = function() {
  const setButton = (button, disabled) => {
    button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    button.style.opacity = disabled ? 0.5 : 1;
  };
  setButton(this.scrollUpButton_, this.getTopRowIndex() == 0);
  setButton(this.scrollDownButton_, true);
};

/**
 * Redraw the current hterm.ScrollPort.
 *
 * When redrawing, we are careful to make sure that the rows that start or end
 * the current selection are not touched in any way.  Doing so would disturb
 * the selection, and cleaning up after that would cause flashes at best and
 * incorrect selection at worst.  Instead, we modify the DOM around these nodes.
 * We even stash the selection start/end outside of the visible area if
 * they are not supposed to be visible in the hterm.ScrollPort.
 */
hterm.ScrollPort.prototype.redraw_ = function() {
  this.resetSelectBags_();
  this.selection.sync();

  this.syncScrollHeight();

  this.currentRowNodeCache_ = {};

  const topRowIndex = this.getTopRowIndex();
  const bottomRowIndex = this.getBottomRowIndex(topRowIndex);

  this.drawTopFold_(topRowIndex);
  this.drawBottomFold_(bottomRowIndex);
  this.drawVisibleRows_(topRowIndex, bottomRowIndex);
  this.ariaHideOffscreenSelectionRows_(topRowIndex, bottomRowIndex);

  this.syncRowNodesDimensions_();

  this.previousRowNodeCache_ = this.currentRowNodeCache_;
  this.currentRowNodeCache_ = null;

  this.updateScrollButtonState_();
};

/**
 * Ensure that the nodes above the top fold are as they should be.
 *
 * If the selection start and/or end nodes are above the visible range
 * of this hterm.ScrollPort then the dom will be adjusted so that they appear
 * before the top fold (the first x-fold element, aka this.topFold).
 *
 * If not, the top fold will be the first element.
 *
 * It is critical that this method does not move the selection nodes.  Doing
 * so would clear the current selection.  Instead, the rest of the DOM is
 * adjusted around them.
 *
 * @param {number} topRowIndex
 */
hterm.ScrollPort.prototype.drawTopFold_ = function(topRowIndex) {
  if (!this.selection.startRow ||
      this.selection.startRow.rowIndex >= topRowIndex) {
    // Selection is entirely below the top fold, just make sure the fold is
    // the first child.
    if (this.rowNodes_.firstChild != this.topFold_) {
      this.rowNodes_.insertBefore(this.topFold_, this.rowNodes_.firstChild);
    }

    return;
  }

  if (!this.selection.isMultiline ||
      this.selection.endRow.rowIndex >= topRowIndex) {
    // Only the startRow is above the fold.
    if (this.selection.startRow.nextSibling != this.topFold_) {
      this.rowNodes_.insertBefore(this.topFold_,
                                  this.selection.startRow.nextSibling);
    }
  } else {
    // Both rows are above the fold.
    if (this.selection.endRow.nextSibling != this.topFold_) {
      this.rowNodes_.insertBefore(this.topFold_,
                                  this.selection.endRow.nextSibling);
    }

    // Trim any intermediate lines.
    while (this.selection.startRow.nextSibling !=
           this.selection.endRow) {
      this.rowNodes_.removeChild(this.selection.startRow.nextSibling);
    }
  }

  while (this.rowNodes_.firstChild != this.selection.startRow) {
    this.rowNodes_.removeChild(this.rowNodes_.firstChild);
  }
};

/**
 * Ensure that the nodes below the bottom fold are as they should be.
 *
 * If the selection start and/or end nodes are below the visible range
 * of this hterm.ScrollPort then the dom will be adjusted so that they appear
 * after the bottom fold (the second x-fold element, aka this.bottomFold).
 *
 * If not, the bottom fold will be the last element.
 *
 * It is critical that this method does not move the selection nodes.  Doing
 * so would clear the current selection.  Instead, the rest of the DOM is
 * adjusted around them.
 *
 * @param {number} bottomRowIndex
 */
hterm.ScrollPort.prototype.drawBottomFold_ = function(bottomRowIndex) {
  if (!this.selection.endRow ||
      this.selection.endRow.rowIndex <= bottomRowIndex) {
    // Selection is entirely above the bottom fold, just make sure the fold is
    // the last child.
    if (this.rowNodes_.lastChild != this.bottomFold_) {
      this.rowNodes_.appendChild(this.bottomFold_);
    }

    return;
  }

  if (!this.selection.isMultiline ||
      this.selection.startRow.rowIndex <= bottomRowIndex) {
    // Only the endRow is below the fold.
    if (this.bottomFold_.nextSibling != this.selection.endRow) {
      this.rowNodes_.insertBefore(this.bottomFold_,
                                  this.selection.endRow);
    }
  } else {
    // Both rows are below the fold.
    if (this.bottomFold_.nextSibling != this.selection.startRow) {
      this.rowNodes_.insertBefore(this.bottomFold_,
                                  this.selection.startRow);
    }

    // Trim any intermediate lines.
    while (this.selection.startRow.nextSibling !=
           this.selection.endRow) {
      this.rowNodes_.removeChild(this.selection.startRow.nextSibling);
    }
  }

  while (this.rowNodes_.lastChild != this.selection.endRow) {
    this.rowNodes_.removeChild(this.rowNodes_.lastChild);
  }
};

/**
 * Ensure that the rows between the top and bottom folds are as they should be.
 *
 * This method assumes that drawTopFold_() and drawBottomFold_() have already
 * run, and that they have left any visible selection row (selection start
 * or selection end) between the folds.
 *
 * It recycles DOM nodes from the previous redraw where possible, but will ask
 * the rowSource to make new nodes if necessary.
 *
 * It is critical that this method does not move the selection nodes.  Doing
 * so would clear the current selection.  Instead, the rest of the DOM is
 * adjusted around them.
 *
 * @param {number} topRowIndex
 * @param {number} bottomRowIndex
 */
hterm.ScrollPort.prototype.drawVisibleRows_ = function(
    topRowIndex, bottomRowIndex) {
  // Keep removing nodes, starting with currentNode, until we encounter
  // targetNode.  Throws on failure.
  const removeUntilNode = (currentNode, targetNode) => {
    while (currentNode != targetNode) {
      if (!currentNode) {
        throw new Error('Did not encounter target node');
      }

      if (currentNode == this.bottomFold_) {
        throw new Error('Encountered bottom fold before target node');
      }

      const deadNode = currentNode;
      currentNode = currentNode.nextSibling;
      deadNode.remove();
    }
  };

  // Shorthand for things we're going to use a lot.
  const selectionStartRow = this.selection.startRow;
  const selectionEndRow = this.selection.endRow;
  const bottomFold = this.bottomFold_;

  // The node we're examining during the current iteration.
  let node = this.topFold_.nextSibling;

  const targetDrawCount = Math.min(this.visibleRowCount,
                                   this.vportctx_.getRowCount());

  for (let drawCount = 0; drawCount < targetDrawCount; drawCount++) {
    const rowIndex = topRowIndex + drawCount;

    if (node == bottomFold) {
      // We've hit the bottom fold, we need to insert a new row.
      const newNode = this.fetchRowNode_(rowIndex);
      if (!newNode) {
        console.log("Couldn't fetch row index: " + rowIndex);
        break;
      }

      this.rowNodes_.insertBefore(newNode, node);
      continue;
    }

    if (node.rowIndex == rowIndex) {
      // This node is in the right place, move along.
      node = node.nextSibling;
      continue;
    }

    if (selectionStartRow && selectionStartRow.rowIndex == rowIndex) {
      // The selection start row is supposed to be here, remove nodes until
      // we find it.
      removeUntilNode(node, selectionStartRow);
      node = selectionStartRow.nextSibling;
      continue;
    }

    if (selectionEndRow && selectionEndRow.rowIndex == rowIndex) {
      // The selection end row is supposed to be here, remove nodes until
      // we find it.
      removeUntilNode(node, selectionEndRow);
      node = selectionEndRow.nextSibling;
      continue;
    }

    if (node == selectionStartRow || node == selectionEndRow) {
      // We encountered the start/end of the selection, but we don't want it
      // yet.  Insert a new row instead.
      const newNode = this.fetchRowNode_(rowIndex);
      if (!newNode) {
        console.log("Couldn't fetch row index: " + rowIndex);
        break;
      }

      this.rowNodes_.insertBefore(newNode, node);
      continue;
    }

    // There is nothing special about this node, but it's in our way.  Replace
    // it with the node that should be here.
    const newNode = this.fetchRowNode_(rowIndex);
    if (!newNode) {
      console.log("Couldn't fetch row index: " + rowIndex);
      break;
    }

    if (node == newNode) {
      node = node.nextSibling;
      continue;
    }

    this.rowNodes_.insertBefore(newNode, node);
    this.rowNodes_.removeChild(node);
    node = newNode.nextSibling;
  }

  if (node != this.bottomFold_) {
    removeUntilNode(node, bottomFold);
  }
};

/**
 * Ensure aria-hidden is set on any selection rows that are offscreen.
 *
 * The attribute aria-hidden is set to 'true' so that hidden rows are ignored
 * by screen readers.  We keep a list of currently hidden rows so they can be
 * reset each time this function is called as the selection and/or scrolling
 * may have changed.
 *
 * @param {number} topRowIndex Index of top row on screen.
 * @param {number} bottomRowIndex Index of bottom row on screen.
 */
hterm.ScrollPort.prototype.ariaHideOffscreenSelectionRows_ = function(
    topRowIndex, bottomRowIndex) {
  // Reset previously hidden selection rows.
  const hiddenRows = this.ariaHiddenSelectionRows_;
  let row;
  while ((row = hiddenRows.pop())) {
    row.removeAttribute('aria-hidden');
  }

  function checkRow(row) {
    if (row && (row.rowIndex < topRowIndex || row.rowIndex > bottomRowIndex)) {
      row.setAttribute('aria-hidden', 'true');
      hiddenRows.push(row);
    }
  }
  checkRow(this.selection.startRow);
  checkRow(this.selection.endRow);
};

/**
 * Empty out both select bags and remove them from the document.
 *
 * These nodes hold the text between the start and end of the selection
 * when that text is otherwise off screen.  They are filled out in the
 * onCopy_ event.
 */
hterm.ScrollPort.prototype.resetSelectBags_ = function() {
  if (this.topSelectBag_.parentNode) {
    this.topSelectBag_.textContent = '';
    this.topSelectBag_.remove();
  }

  if (this.bottomSelectBag_.parentNode) {
    this.bottomSelectBag_.textContent = '';
    this.bottomSelectBag_.remove();
  }
};

/**
 * Place a row node in the cache of visible nodes.
 *
 * This method may only be used during a redraw_.
 *
 * @param {!Node} rowNode
 */
hterm.ScrollPort.prototype.cacheRowNode_ = function(rowNode) {
  this.currentRowNodeCache_[rowNode.rowIndex] = rowNode;
};

/**
 * Fetch the row node for the given index.
 *
 * This will return a node from the cache if possible, or will request one
 * from the Vportctx if not.
 *
 * If a redraw_ is in progress the row will be added to the current cache.
 *
 * @param {number} rowIndex
 * @return {!Node}
 */
hterm.ScrollPort.prototype.fetchRowNode_ = function(rowIndex) {
  let node;

  if (this.previousRowNodeCache_ && rowIndex in this.previousRowNodeCache_) {
    node = this.previousRowNodeCache_[rowIndex];
  } else {
    node = this.vportctx_.getRowNode(rowIndex);
  }

  if (this.currentRowNodeCache_) {
    this.cacheRowNode_(node);
  }

  return node;
};

/**
 * Select all rows in the terminal including scrollback.
 */
hterm.ScrollPort.prototype.selectAll = function() {
  let firstRow;

  if (this.topFold_.nextSibling.rowIndex != 0) {
    while (this.topFold_.previousSibling) {
      this.topFold_.previousSibling.remove();
    }

    firstRow = this.fetchRowNode_(0);
    this.rowNodes_.insertBefore(firstRow, this.topFold_);
    this.syncRowNodesDimensions_();
  } else {
    firstRow = this.topFold_.nextSibling;
  }

  const lastRowIndex = this.vportctx_.getRowCount() - 1;
  let lastRow;

  if (this.bottomFold_.previousSibling.rowIndex != lastRowIndex) {
    while (this.bottomFold_.nextSibling) {
      this.bottomFold_.nextSibling.remove();
    }

    lastRow = this.fetchRowNode_(lastRowIndex);
    this.rowNodes_.appendChild(lastRow);
  } else {
    lastRow = this.bottomFold_.previousSibling;
  }

  let focusNode = lastRow;
  while (focusNode.lastChild) {
    focusNode = focusNode.lastChild;
  }

  const selection = this.document_.getSelection();
  selection.collapse(firstRow, 0);
  selection.extend(focusNode, focusNode.length || 0);

  this.selection.sync();
};

/**
 * Return the maximum scroll position in pixels.
 *
 * @return {number}
 */
hterm.ScrollPort.prototype.getScrollMax_ = function() {
  return this.scrollHeight_ +
         this.visibleRowTopMargin + this.visibleRowBottomMargin -
         this.physpixdim(this.x_screen).height;
};

/**
 * Scroll the given rowIndex to the top of the hterm.ScrollPort.
 *
 * @param {number} rowIndex Index of the target row.
 */
hterm.ScrollPort.prototype.scrollRowToTop = function(rowIndex) {
  // Other scrollRowTo* functions and scrollLineUp could pass rowIndex < 0.
  if (rowIndex < 0) {
    rowIndex = 0;
  }

  this.syncScrollHeight();

  let scrotop = rowIndex * this.characterSize.height +
      this.visibleRowTopMargin;

  const scrollMax = this.getScrollMax_();
  if (scrotop > scrollMax) {
    scrotop = scrollMax;
  }

  if (scrotop != this.scroll_top) {
    this.scroll_top = scrotop;
    setTimeout(this.onScroll_.bind(this, 'whatever'), 0);
  }
  this.scheduleRedraw();
};

/**
 * Scroll the given rowIndex to the bottom of the hterm.ScrollPort.
 *
 * @param {number} rowIndex Index of the target row.
 */
hterm.ScrollPort.prototype.scrollRowToBottom = function(rowIndex) {
  this.scrollRowToTop(rowIndex - this.visibleRowCount);
};

/**
 * Scroll the given rowIndex to the middle of the hterm.ScrollPort.
 *
 * @param {number} rowIndex Index of the target row.
 */
hterm.ScrollPort.prototype.scrollRowToMiddle = function(rowIndex) {
  this.scrollRowToTop(rowIndex - Math.floor(this.visibleRowCount / 2));
};

/**
 * Return the row index of the first visible row.
 *
 * This is based on the scroll position.  If a redraw_ is in progress this
 * returns the row that *should* be at the top.
 *
 * @return {number}
 */
hterm.ScrollPort.prototype.getTopRowIndex = function() {
  return Math.round(this.scroll_top / this.characterSize.height);
};

/**
 * Return the row index of the last visible row.
 *
 * This is based on the scroll position.  If a redraw_ is in progress this
 * returns the row that *should* be at the bottom.
 *
 * @param {number} topRowIndex
 * @return {number}
 */
hterm.ScrollPort.prototype.getBottomRowIndex = function(topRowIndex) {
  return topRowIndex + this.visibleRowCount - 1;
};

/**
 * Handler for scroll events.
 *
 * The onScroll event fires when ScrollPort.scroll_top changes.  This
 * may be due to the user manually move the scrollbar, or a programmatic change.
 *
 * @param {!Event} e
 */
hterm.ScrollPort.prototype.onScroll_ = function(e) {
  const screenSize = this.getScreenSize();
  if (screenSize.width != this.lastScreenWidth_ ||
      screenSize.height != this.lastScreenHeight_) {
    // This event may also fire during a resize (but before the resize event!).
    // This happens when the browser moves the scrollbar as part of the resize.
    // In these cases, we want to ignore the scroll event and let onResize
    // handle things.  If we don't, then we end up scrolling to the wrong
    // position after a resize.
    this.resize();
    return;
  }

  this.redraw_();
  this.publish('scroll', {scrollPort: this});
};

/**
 * Clients can override this if they want to hear scrollwheel events.
 *
 * Clients may call event.preventDefault() if they want to keep the scrollport
 * from also handling the events.
 *
 * @param {!WheelEvent} e
 */
hterm.ScrollPort.prototype.onScrollWheel = function(e) {};

hterm.ScrollPort.prototype.onScrollWheel_ = function(e) {
  this.onScrollWheel(e);
};

/**
 * Calculate how far a wheel event should scroll.
 *
 * This normalizes the browser's concept of a scroll (pixels, lines, etc...)
 * into a standard pixel distance.
 *
 * @param {!WheelEvent} e The mouse wheel event to process.
 * @return {{x:number, y:number}} The x & y of how far (in pixels) to scroll.
 */
hterm.ScrollPort.prototype.scrollWheelDelta = function(e) {
  const delta = {x: 0, y: 0};

  switch (e.deltaMode) {
    case WheelEvent.DOM_DELTA_PIXEL:
      delta.x = e.deltaX * this.scrollWheelMultiplier_;
      delta.y = e.deltaY * this.scrollWheelMultiplier_;
      break;
    case WheelEvent.DOM_DELTA_LINE:
      delta.x = e.deltaX * this.characterSize.width;
      delta.y = e.deltaY * this.characterSize.height;
      break;
    case WheelEvent.DOM_DELTA_PAGE: {
      const {width, height} = this.physpixdim(this.x_screen);
      delta.x = e.deltaX * this.characterSize.width * width;
      delta.y = e.deltaY * this.characterSize.height * height;
      break;
    }
  }

  // The Y sign is inverted from what we would expect: up/down are
  // negative/positive respectively.  The X sign is correct though: left/right
  // are negative/positive respectively.
  delta.y *= -1;

  return delta;
};

/**
 * Clients can override this if they want to hear copy events.
 *
 * Clients may call event.preventDefault() if they want to keep the scrollport
 * from also handling the events.
 *
 * @param {!ClipboardEvent} e
 */
hterm.ScrollPort.prototype.onCopy = function(e) { };

/**
 * Handler for copy-to-clipboard events.
 *
 * If some or all of the selected rows are off screen we may need to fill in
 * the rows between selection start and selection end.  This handler determines
 * if we're missing some of the selected text, and if so populates one or both
 * of the "select bags" with the missing text.
 *
 * @param {!ClipboardEvent} e
 */
hterm.ScrollPort.prototype.onCopy_ = function(e) {
  this.onCopy(e);

  if (e.defaultPrevented) {
    return;
  }

  this.resetSelectBags_();
  this.selection.sync();

  if (this.selection.isCollapsed ||
      this.selection.endRow.rowIndex - this.selection.startRow.rowIndex < 2) {
    return;
  }

  const topRowIndex = this.getTopRowIndex();
  const bottomRowIndex = this.getBottomRowIndex(topRowIndex);

  if (this.selection.startRow.rowIndex < topRowIndex) {
    // Start of selection is above the top fold.
    let endBackfillIndex;

    if (this.selection.endRow.rowIndex < topRowIndex) {
      // Entire selection is above the top fold.
      endBackfillIndex = this.selection.endRow.rowIndex;
    } else {
      // Selection extends below the top fold.
      endBackfillIndex = this.topFold_.nextSibling.rowIndex;
    }

    this.topSelectBag_.textContent = this.vportctx_.getRowsText(
        this.selection.startRow.rowIndex + 1, endBackfillIndex);
    this.rowNodes_.insertBefore(this.topSelectBag_,
                                this.selection.startRow.nextSibling);
    this.syncRowNodesDimensions_();
  }

  if (this.selection.endRow.rowIndex > bottomRowIndex) {
    // Selection ends below the bottom fold.
    let startBackfillIndex;

    if (this.selection.startRow.rowIndex > bottomRowIndex) {
      // Entire selection is below the bottom fold.
      startBackfillIndex = this.selection.startRow.rowIndex + 1;
    } else {
      // Selection starts above the bottom fold.
      startBackfillIndex = this.bottomFold_.previousSibling.rowIndex + 1;
    }

    this.bottomSelectBag_.textContent = this.vportctx_.getRowsText(
        startBackfillIndex, this.selection.endRow.rowIndex);
    this.rowNodes_.insertBefore(this.bottomSelectBag_, this.selection.endRow);
  }
};

/**
 * Handle a paste event on the the ScrollPort's screen element.
 *
 * TODO: Handle ClipboardData.files transfers.  https://crbug.com/433581.
 *
 * @param {!ClipboardEvent} e
 */
hterm.ScrollPort.prototype.onPaste_ = function(e) {
  this.pasteTarget_.focus();

  setTimeout(() => {
    this.publish('paste', {text: this.pasteTarget_.value});
    this.pasteTarget_.value = '';
    this.focus();
  });
};

/**
 * Handles a textInput event on the paste target. Stops this from
 * propagating as we want this to be handled in the onPaste_ method.
 *
 * @param {!Event} e
 */
hterm.ScrollPort.prototype.handlePasteTargetTextInput_ = function(e) {
  e.stopPropagation();
};

/**
 * Handle a drop event on the the ScrollPort's screen element.
 *
 * By default we try to copy in the structured format (HTML/whatever).
 * The shift key can select plain text though.
 *
 * TODO: Handle DataTransfer.files transfers.  https://crbug.com/433581.
 *
 * @param {!DragEvent} e The drag event that fired us.
 */
hterm.ScrollPort.prototype.onDragAndDrop_ = function(e) {
  if (!this.pasteOnDrop) {
    return;
  }

  e.preventDefault();

  let data;
  let format;

  // If the shift key active, try to find a "rich" text source (but not plain
  // text).  e.g. text/html is OK.
  if (e.shiftKey) {
    e.dataTransfer.types.forEach((t) => {
      if (!format && t != 'text/plain' && t.startsWith('text/')) {
        format = t;
      }
    });

    // If we found a non-plain text source, try it out first.
    if (format) {
      data = e.dataTransfer.getData(format);
    }
  }

  // If we haven't loaded anything useful, fall back to plain text.
  if (!data) {
    data = e.dataTransfer.getData('text/plain');
  }

  if (data) {
    this.publish('paste', {text: data});
  }
};

/**
 * Set scroll wheel multiplier. This alters how much the screen scrolls on
 * mouse wheel events.
 *
 * @param {number} multiplier
 */
hterm.ScrollPort.prototype.setScrollWheelMoveMultipler = function(multiplier) {
  this.scrollWheelMultiplier_ = multiplier;
};
// SOURCE FILE: hterm/js/hterm_terminal.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Constructor for the Terminal class.
 *
 * A Terminal pulls together the hterm.ScrollPort, hterm.Screen and hterm.VT100
 * classes to provide the complete terminal functionality.
 *
 * There are a number of lower-level Terminal methods that can be called
 * directly to manipulate the cursor, text, scroll region, and other terminal
 * attributes.  However, the primary method is interpret(), which parses VT
 * escape sequences and invokes the appropriate Terminal methods.
 *
 * This class was heavily influenced by Cory Maccarrone's Framebuffer class.
 *
 * TODO(rginda): Eventually we're going to need to support characters which are
 * displayed twice as wide as standard latin characters.  This is to support
 * CJK (and possibly other character sets).
 *
 * @param {{
 *   profileId: (?string|undefined),
 *   storage: (!lib.Storage|undefined),
 * }=} options Various settings to control behavior.
 *     profileId: The preference profile name.  Defaults to "default".
 *     storage: The backing storage for preferences.  Defaults to local.
 * @constructor
 * @implements {hterm.Vportctx}
 */
hterm.Terminal = function({profileId, storage} = {}) {
  // Set to true once terminal is initialized and onTerminalReady() is called.
  this.ready_ = false;

  this.profileId_ = null;
  this.storage_ = storage || new lib.Storage.Memory();

  /** @type {?hterm.PreferenceManager} */
  this.prefs_ = null;

  // Two screen instances.
  this.primaryScreen_ = new hterm.Screen();
  this.alternateScreen_ = new hterm.Screen();

  // The "current" screen.
  this.screen_ = this.primaryScreen_;

  // The local notion of the screen size.  ScreenBuffers also have a size which
  // indicates their present size.  During size changes, the two may disagree.
  // Also, the inactive screen's size is not altered until it is made the active
  // screen.
  this.screenSize = {width: 0, height: 0};

  // The scroll port we'll be using to display the visible rows.
  this.scroll_port = new hterm.ScrollPort(this);
  this.scroll_port.subscribe('resize', this.onResize_.bind(this));
  this.scroll_port.subscribe('scroll', this.onScroll_.bind(this));
  this.scroll_port.subscribe('paste', this.onPaste_.bind(this));
  this.scroll_port.subscribe('focus', this.onScrollportFocus_.bind(this));
  this.scroll_port.subscribe('options', this.onOpenOptionsPage_.bind(this));
  this.scroll_port.onCopy = this.onCopy_.bind(this);

  // The div that contains this terminal.
  this.div_ = null;

  // UI for showing info to the user in a privileged way.
  this.notifications_ = null;

  // The document that contains the scrollPort.  Defaulted to the global
  // document here so that the terminal is functional even if it hasn't been
  // inserted into a document yet, but re-set in decorate().
  this.document_ = window.document;

  this.discarded_rows = 0;

  // Saved tab stops.
  this.tabStops_ = [];

  // Keep track of whether default tab stops have been erased; after a TBC
  // clears all tab stops, defaults aren't restored on resize until a reset.
  this.defaultTabStops = true;

  // The VT's notion of the top and bottom rows.  Used during some VT
  // cursor positioning and scrolling commands.
  this.vtScrollTop_ = null;
  this.vtScrollBottom_ = null;

  // The DIV element for the visible cursor.
  this.termCursNode = null;

  // '_' shape is user preference.
  this.cursorShape_ = '_';

  // Cursor is hidden when scrolling up pushes it off the bottom of the screen.
  this.cursorOffScreen_ = false;

  // These prefs are cached so we don't have to read from local storage with
  // each output and keystroke.  They are initialized by the preference manager.
  /** @type {?string} */
  this.backgroundColor_ = null;
  /** @type {?string} */
  this.foregroundColor_ = null;

  /** @type {!Map<number, string>} */
  this.colorPaletteOverrides_ = new Map();

  this.screenBorderSize_ = 0;

  // True if we should override mouse event reporting to allow local selection.
  this.defeatMouseReports_ = false;

  // Whether to auto hide the mouse cursor when typing.
  this.setAutomaticMouseHiding();
  // Timer to keep mouse visible while it's being used.
  this.mouseHideDelay_ = null;

  // The AccessibilityReader object for announcing command output.
  this.accessibilityReader_ = null;

  this.bellNotificationList_ = [];

  // Whether we have permission to display notifications.
  this.desktopNotificationBell_ = false;

  // Cursor position and attributes saved with DECSC.
  this.savedOptions_ = {};

  // The current mode bits for the terminal.
  this.options_ = new hterm.Options();

  // Timeouts we might need to clear.
  this.timeouts_ = {};

  // The VT escape sequence interpreter.
  this.vt = new hterm.VT(this);

  this.saveCursorAndState(true);

  // General IO interface that can be given to third parties without exposing
  // the entire terminal object.
  this.io = new hterm.Terminal.IO(this);

  // True if mouse-click-drag should scroll the terminal.
  this.enableMouseDragScroll = true;

  this.copyOnSelect = null;

  // Use right button to paste.
  this.mousePasteButton = 2;

  // Whether to use the default window copy behavior.
  this.useDefaultWindowCopy = false;

  this.clearSelectionAfterCopy = true;

  this.realizeSize_(80, 24);
  this.setDefaultTabStops();

  // Whether we allow images to be shown.
  this.allowImagesInline = null;

  this.reportFocus = false;

  // TODO(crbug.com/1063219) Remove this once the bug is fixed.
  this.alwaysUseLegacyPasting = false;

  this.setProfile(profileId || hterm.Terminal.DEFAULT_PROFILE_ID,
                  function() { this.onTerminalReady(); }.bind(this));
};

hterm.Terminal.prototype.scroll_rows_off = function(cnt)
{
	var rows, i, new_len;

	if (!cnt) return;

	rows = this.screen_.rowsArray;

	new_len = rows.length - cnt;
	for (i = 0; i < new_len; i++) rows[i] = rows[i+cnt];

	rows.length = new_len;

	this.discarded_rows += cnt;
};

/**
 * Default Profile ID.
 *
 * @const {string}
 */
hterm.Terminal.DEFAULT_PROFILE_ID = 'default';

/**
 * Clients should override this to be notified when the terminal is ready
 * for use.
 *
 * The terminal initialization is asynchronous, and shouldn't be used before
 * this method is called.
 */
hterm.Terminal.prototype.onTerminalReady = function() { };

/**
 * Default tab with of 8 to match xterm.
 */
hterm.Terminal.prototype.tabWidth = 8;

/**
 * Select a preference profile.
 *
 * This will load the terminal preferences for the given profile name and
 * associate subsequent preference changes with the new preference profile.
 *
 * @param {string} profileId The name of the preference profile.  Forward slash
 *     characters will be removed from the name.
 * @param {function()=} callback Optional callback to invoke when the
 *     profile transition is complete.
 */
hterm.Terminal.prototype.setProfile = function(
    profileId, callback = undefined) {
  profileId = profileId.replace(/[/]/g, '');
  if (this.profileId_ === profileId) {
    if (callback) {
      callback();
    }
    return;
  }

  this.profileId_ = profileId;

  if (this.prefs_) {
    this.prefs_.setProfile(profileId, callback);
    return;
  }

  this.prefs_ = new hterm.PreferenceManager(this.storage_, this.profileId_);

  this.prefs_.addObservers(null, {
    'desktop-notification-bell': (v) => {
      if (v && Notification) {
        this.desktopNotificationBell_ = Notification.permission === 'granted';
        if (!this.desktopNotificationBell_) {
          // Note: We don't call Notification.requestPermission here because
          // Chrome requires the call be the result of a user action (such as an
          // onclick handler), and pref listeners are run asynchronously.
          //
          // A way of working around this would be to display a dialog in the
          // terminal with a "click-to-request-permission" button.
          console.warn('desktop-notification-bell is true but we do not have ' +
                       'permission to display notifications.');
        }
      } else {
        this.desktopNotificationBell_ = false;
      }
    },

    'background-color': (v) => {
      this.setBackgroundColor(v);
    },

    'background-size': (v) => {
      this.scroll_port.setBackgroundSize(v);
    },

    'background-position': (v) => {
      this.scroll_port.setBackgroundPosition(v);
    },

    'character-map-overrides': (v) => {
      if (!(v == null || v instanceof Object)) {
        console.warn('Preference character-map-modifications is not an ' +
                     'object: ' + v);
        return;
      }

      this.vt.characterMaps.reset();
      this.vt.characterMaps.setOverrides(v);
    },

    'color-palette-overrides': (v) => {
      if (!(v == null || v instanceof Object || v instanceof Array)) {
        console.warn('Preference color-palette-overrides is not an array or ' +
                     'object: ' + v);
        return;
      }

      // Reset all existing colors first as the new palette override might not
      // have the same mappings.  If the old one set colors the new one doesn't,
      // those old mappings have to get cleared first.
      lib.colors.stockPalette.forEach((c, i) => this.setColorPalette(i, c));
      this.colorPaletteOverrides_.clear();

      if (v) {
        for (const key in v) {
          const i = parseInt(key, 10);
          if (isNaN(i) || i < 0 || i > 255) {
            console.log('Invalid value in palette: ' + key + ': ' + v[key]);
            continue;
          }

          if (v[i]) {
            const rgb = lib.colors.normalizeCSS(v[i]);
            if (rgb) {
              this.setColorPalette(i, rgb);
              this.colorPaletteOverrides_.set(i, rgb);
            }
          }
        }
      }

      this.primaryScreen_.scrTextAttr.colorPaletteOverrides = [];
      this.alternateScreen_.scrTextAttr.colorPaletteOverrides = [];
    },

    'copy-on-select': (v) => {
      this.copyOnSelect = !!v;
    },

    'use-default-window-copy': (v) => {
      this.useDefaultWindowCopy = !!v;
    },

    'clear-selection-after-copy': (v) => {
      this.clearSelectionAfterCopy = !!v;
    },

    'east-asian-ambiguous-as-two-column': (v) => {
      lib.wc.regardCjkAmbiguous = v;
    },

    'enable-8-bit-control': (v) => {
      this.vt.enable8BitControl = !!v;
    },

    'enable-bold-as-bright': (v) => {
      this.primaryScreen_.scrTextAttr.enableBoldAsBright = !!v;
      this.alternateScreen_.scrTextAttr.enableBoldAsBright = !!v;
    },

    'foreground-color': (v) => {
      this.setForegroundColor(v);
    },

    'hide-mouse-while-typing': (v) => {
      this.setAutomaticMouseHiding(v);
    },

    'screen-padding-size': (v) => {
      v = parseInt(v, 10);
      if (isNaN(v) || v < 0) {
        console.error(`Invalid screen padding size: ${v}`);
        return;
      }
      this.setScreenPaddingSize(v);
    },

    'screen-border-size': (v) => {
      v = parseInt(v, 10);
      if (isNaN(v) || v < 0) {
        console.error(`Invalid screen border size: ${v}`);
        return;
      }
      this.setScreenBorderSize(v);
    },

    'screen-border-color': (v) => {
      this.div_.style.borderColor = v;
    },

    'scroll-wheel-move-multiplier': (v) => {
      this.setScrollWheelMoveMultipler(v);
    },

    'terminal-encoding': (v) => {
      this.vt.setEncoding(v);
    },

    'allow-images-inline': (v) => {
      this.allowImagesInline = v;
    },
  });

  this.prefs_.readStorage(function() {
    this.prefs_.notifyAll();

    if (callback) {
      this.ready_ = true;
      callback();
    }
  }.bind(this));
};

/**
 * Returns the preferences manager used for configuring this terminal.
 *
 * @return {!hterm.PreferenceManager}
 */
hterm.Terminal.prototype.getPrefs = function() {
  return lib.notNull(this.prefs_);
};

/**
 * Enable or disable bracketed paste mode.
 *
 * @param {boolean} state The value to set.
 */
hterm.Terminal.prototype.setBracketedPaste = function(state) {
  this.options_.bracketedPaste = state;
};

/**
 * Set the color for the cursor.
 *
 * If you want this setting to persist, set it through prefs_, rather than
 * with this method.
 *
 * @param {string=} color The color to set.  If not defined, we reset to the
 *     saved user preference.
 */
hterm.Terminal.prototype.setCursorColor = function(color) {
  this.setCssVar('cursor-color', color || 'hsl(100, 60%, 80%)');
};

/**
 * Enable or disable mouse based text selection in the terminal.
 *
 * @param {boolean} state The value to set.
 */
hterm.Terminal.prototype.setSelectionEnabled = function(state) {
  this.enableMouseDragScroll = state;
};

/**
 * Set the background color.
 *
 * If you want this setting to persist, set it through prefs_, rather than
 * with this method.
 *
 * @param {string=} color The color to set.  If not defined, we reset to the
 *     saved user preference.
 */
hterm.Terminal.prototype.setBackgroundColor = function(color) {
  if (color === undefined) {
    color = this.prefs_.getString('background-color');
  }

  this.backgroundColor_ = lib.colors.normalizeCSS(color);
  this.setRgbColorCssVar('background-color', this.backgroundColor_);
};

/**
 * Return the current terminal background color.
 *
 * Intended for use by other classes, so we don't have to expose the entire
 * prefs_ object.
 *
 * @return {?string}
 */
hterm.Terminal.prototype.getBackgroundColor = function() {
  return this.backgroundColor_;
};

/**
 * Set the foreground color.
 *
 * If you want this setting to persist, set it through prefs_, rather than
 * with this method.
 *
 * @param {string=} color The color to set.  If not defined, we reset to the
 *     saved user preference.
 */
hterm.Terminal.prototype.setForegroundColor = function(color) {
  if (color === undefined) {
    color = this.prefs_.getString('foreground-color');
  }

  this.foregroundColor_ = lib.colors.normalizeCSS(color);
  this.setRgbColorCssVar('foreground-color', this.foregroundColor_);
};

/**
 * Return the current terminal foreground color.
 *
 * Intended for use by other classes, so we don't have to expose the entire
 * prefs_ object.
 *
 * @return {?string}
 */
hterm.Terminal.prototype.getForegroundColor = function() {
  return this.foregroundColor_;
};

/**
 * Returns true if the current screen is the primary screen, false otherwise.
 *
 * @return {boolean}
 */
hterm.Terminal.prototype.isPrimaryScreen = function() {
  return this.screen_ == this.primaryScreen_;
};

/**
 * Set a CSS variable.
 *
 * Normally this is used to set variables in the hterm namespace.
 *
 * @param {string} name The variable to set.
 * @param {string|number} value The value to assign to the variable.
 * @param {string=} prefix The variable namespace/prefix to use.
 */
hterm.Terminal.prototype.setCssVar = function(name, value,
                                              prefix = '--hterm-') {
  this.document_.documentElement.style.setProperty(
      `${prefix}${name}`, value.toString());
};

/**
 * Sets --hterm-{name} to the cracked rgb components (no alpha) if the provided
 * input is valid.
 *
 * @param {string} name The variable to set.
 * @param {?string} rgb The rgb value to assign to the variable.
 */
hterm.Terminal.prototype.setRgbColorCssVar = function(name, rgb) {
  const ary = rgb ? lib.colors.crackRGB(rgb) : null;
  if (ary) {
    this.setCssVar(name, ary.slice(0, 3).join(','));
  }
};

/**
 * Sets the specified color for the active screen.
 *
 * @param {number} i The index into the 256 color palette to set.
 * @param {?string} rgb The rgb value to assign to the variable.
 */
hterm.Terminal.prototype.setColorPalette = function(i, rgb) {
  if (i >= 0 && i < 256 && rgb != null && rgb != this.getColorPalette[i]) {
    this.setRgbColorCssVar(`color-${i}`, rgb);
    this.screen_.scrTextAttr.colorPaletteOverrides[i] = rgb;
  }
};

/**
 * Returns the current value in the active screen of the specified color.
 *
 * @param {number} i Color palette index.
 * @return {string} rgb color.
 */
hterm.Terminal.prototype.getColorPalette = function(i) {
  return this.screen_.scrTextAttr.colorPaletteOverrides[i] ||
      this.colorPaletteOverrides_.get(i) ||
      lib.colors.stockPalette[i];
};

/**
 * Reset the specified color in the active screen to its default value.
 *
 * @param {number} i Color to reset
 */
hterm.Terminal.prototype.resetColor = function(i) {
  this.setColorPalette(
      i, this.colorPaletteOverrides_.get(i) || lib.colors.stockPalette[i]);
  delete this.screen_.scrTextAttr.colorPaletteOverrides[i];
};

/**
 * Reset the current screen color palette to the default state.
 */
hterm.Terminal.prototype.resetColorPalette = function() {
  this.screen_.scrTextAttr.colorPaletteOverrides.forEach(
      (c, i) => this.resetColor(i));
};

/**
 * Get a CSS variable.
 *
 * Normally this is used to get variables in the hterm namespace.
 *
 * @param {string} name The variable to read.
 * @param {string=} prefix The variable namespace/prefix to use.
 * @return {string} The current setting for this variable.
 */
hterm.Terminal.prototype.getCssVar = function(name, prefix = '--hterm-') {
  return this.document_.documentElement.style.getPropertyValue(
      `${prefix}${name}`);
};

/**
 * Update CSS character size variables to match the scrollport.
 */
hterm.Terminal.prototype.updateCssCharsize_ = function() {
  this.setCssVar('charsize-width', dpifud(this.scroll_port.characterSize.width));
  this.setCssVar('charsize-height',
                 dpifud(this.scroll_port.characterSize.height));
};

/**
 * Set the font size for this terminal.
 *
 * @param {number} px The desired font size, in pixels.
 */
hterm.Terminal.prototype.setFontSize = function(px) {
  this.scroll_port.x_screen.style.fontSize = dpifud(px);
  this.setCssVar('font-size', dpifud(px));
};

/**
 * Get the current font size.
 *
 * @return {number}
 */
hterm.Terminal.prototype.getFontSize = function() {
  return this.scroll_port.getFontSize();
};

/**
 * Get the current font family.
 *
 * @return {string}
 */
hterm.Terminal.prototype.getFontFamily = function() {
  return this.scroll_port.getFontFamily();
};

/**
 * Set the mouse cursor style based on the current terminal mode.
 */
hterm.Terminal.prototype.syncMouseStyle = function() {
  this.setCssVar('mouse-cursor-style',
                 this.vt.mouseReport == this.vt.MOUSE_REPORT_DISABLED ?
                     'var(--hterm-mouse-cursor-text)' :
                     'var(--hterm-mouse-cursor-default)');
};

function readcursrow(c) { return (c >> 15) & 0x7fff; }
function writcursrow(c, row)
{
	c &= ~(0x7fff << 15);
	c |= (row & 0x7fff) << 15;
	return c;
}

/**
 * Return a copy of the current cursor position.
 *
 * @return {!hterm.RowCol} The RowCol object representing the current position.
 */
hterm.Terminal.prototype.saveCursor = function() {
  return ((this.screen_.cursrow & 0x7fff ) << 15) |
          (this.screen_.curscol & 0x7fff )        |
         ((this.screen_.cursovrfl ? 1 : 0) << 30);
};

/**
 * Restore a previously saved cursor position.
 */
hterm.Terminal.prototype.restoreCursor = function(curs) {
  TMint rawr = (curs >> 15) & 0x7fff;
  TMint rawc = curs & 0x7fff;
  TMint ov = curs >> 30;

  TMint row = rangefit(rawr, 0, this.screenSize.height - 1);
  TMint column = rangefit(rawc, 0, this.screenSize.width - 1);

  this.screen_.setCursorPosition(row, column);
  if (rawc > column || (rawc == column && ov)) {
    this.screen_.cursovrfl = 1;
  }
};

/**
 * Return the current text attributes.
 *
 * @return {!hterm.TextAttributes}
 */
hterm.Terminal.prototype.getTextAttributes = function() {
  return this.screen_.scrTextAttr;
};

/**
 * Set the text attributes.
 *
 * @param {!hterm.TextAttributes} ta The attributes to set.
 */
hterm.Terminal.prototype.setTextAttributes = function(ta) {
  this.screen_.scrTextAttr = ta;
};

/**
 * Change the title of this terminal's window.
 *
 * @param {string} title The title to set.
 */
hterm.Terminal.prototype.setWindowTitle = function(title) {
  window.document.title = title;
};

/**
 * Change the name of the terminal. This is used by tmux, and it is different
 * from the window title. See the "NAMES AND TITLES" section in `man tmux`.
 *
 * @param {string} name The name to set.
 */
hterm.Terminal.prototype.setWindowName = function(name) {};

/**
 * Clear the cursor's overflow flag.
 */
hterm.Terminal.prototype.clearCursorOverflow = function() {
  this.screen_.cursovrfl = 0;
};

/**
 * Save the current cursor state to the corresponding screens.
 *
 * See the hterm.Screen_CursorState class for more details.
 *
 * @param {boolean=} both If true, update both screens, else only update the
 *     current screen.
 */
hterm.Terminal.prototype.saveCursorAndState = function(both) {
  if (both) {
    this.primaryScreen_.saveCursorAndState(this.vt);
    this.alternateScreen_.saveCursorAndState(this.vt);
  } else {
    this.screen_.saveCursorAndState(this.vt);
  }
};

/**
 * Restore the saved cursor state in the corresponding screens.
 *
 * See the hterm.Screen_CursorState class for more details.
 *
 * @param {boolean=} both If true, update both screens, else only update the
 *     current screen.
 */
hterm.Terminal.prototype.restoreCursorAndState = function(both) {
  if (both) {
    this.primaryScreen_.restoreCursorAndState(this.vt);
    this.alternateScreen_.restoreCursorAndState(this.vt);
  } else {
    this.screen_.restoreCursorAndState(this.vt);
  }
};

hterm.Terminal.prototype.setCursorShape = function(shape) {
  this.cursorShape_ = shape;
  this.restyleCursor_();
};

/**
 * Set the screen padding size in pixels.
 *
 * @param {number} size
 */
hterm.Terminal.prototype.setScreenPaddingSize = function(size) {
  this.setCssVar('screen-padding-size', dpifud(size));
  this.scroll_port.setScreenPaddingSize(size);
};

/**
 * Set the screen border size in pixels.
 *
 * @param {number} size
 */
hterm.Terminal.prototype.setScreenBorderSize = function(size) {
  this.div_.style.borderWidth = dpifud(size);
  this.screenBorderSize_ = size;
  this.scroll_port.resize();
};

/**
 * Deal with terminal size changes.
 *
 * @param {number} columnCount The number of columns.
 * @param {number} rowCount The number of rows.
 */
hterm.Terminal.prototype.realizeSize_ = function(columnCount, rowCount) {
  let notify = false;

  if (columnCount != this.screenSize.width) {
    notify = true;
    this.realizeWidth_(columnCount);
  }

  if (rowCount != this.screenSize.height) {
    notify = true;
    this.realizeHeight_(rowCount);
  }

  // Send new terminal size to plugin.
  if (notify) {
    this.io.onTerminalResize_(columnCount, rowCount);
  }
};

/**
 * Deal with terminal width changes.
 *
 * This function does what needs to be done when the terminal width changes
 * out from under us.  It happens here rather than in onResize_() because this
 * code may need to run synchronously to handle programmatic changes of
 * terminal width.
 *
 * Relying on the browser to send us an async resize event means we may not be
 * in the correct state yet when the next escape sequence hits.
 *
 * @param {number} columnCount The number of columns.
 */
hterm.Terminal.prototype.realizeWidth_ = function(columnCount) {
  if (columnCount <= 0) {
    throw new Error('Attempt to realize bad width: ' + columnCount);
  }

  const deltaColumns = columnCount - this.screen_.columnCount_;
  if (deltaColumns == 0) {
    // No change, so don't bother recalculating things.
    return;
  }

  this.screenSize.width = columnCount;
  this.screen_.setColumnCount(columnCount);

  if (deltaColumns > 0) {
    if (this.defaultTabStops) {
      this.setDefaultTabStops(this.screenSize.width - deltaColumns);
    }
  } else {
    for (let i = this.tabStops_.length - 1; i >= 0; i--) {
      if (this.tabStops_[i] < columnCount) {
        break;
      }

      this.tabStops_.pop();
    }
  }

  this.screen_.setColumnCount(this.screenSize.width);
};

/**
 * Deal with terminal height changes.
 *
 * This function does what needs to be done when the terminal height changes
 * out from under us.  It happens here rather than in onResize_() because this
 * code may need to run synchronously to handle programmatic changes of
 * terminal height.
 *
 * Relying on the browser to send us an async resize event means we may not be
 * in the correct state yet when the next escape sequence hits.
 *
 * @param {number} rowCount The number of rows.
 */
hterm.Terminal.prototype.realizeHeight_ = function(rowCount) {
  TMint cursor;

  if (rowCount <= 0) {
    throw new Error('Attempt to realize bad height: ' + rowCount);
  }

  let deltaRows = rowCount - this.screen_.getHeight();
  if (deltaRows == 0) {
    // No change, so don't bother recalculating things.
    return;
  }

  this.screenSize.height = rowCount;

  cursor = this.saveCursor();

  if (deltaRows < 0) {
    // Screen got smaller.
    deltaRows *= -1;
    while (deltaRows) {
      const lastRow = this.getRowCount() - 1;
      if (lastRow - this.discarded_rows == readcursrow(cursor)) {
        break;
      }

      if (this.getRowText(lastRow)) {
        break;
      }

      this.screen_.popRow();
      deltaRows--;
    }

    this.scroll_rows_off(deltaRows);

    // We just removed rows from the top of the screen, we need to update
    // the cursor to match.
    cursor = writcursrow(cursor, Math.max(readcursrow(cursor) - deltaRows, 0));
  } else if (deltaRows > 0) {
    // Screen got larger.
    this.appendRows_(deltaRows);
  }

  this.setVTScrollRegion(null, null);
  this.restoreCursor(cursor);
};

/**
 * Scroll the terminal to the end.
 */
hterm.Terminal.prototype.scrollEnd = function() {
  this.scroll_port.scrollRowToBottom(this.getRowCount());
};

/**
 * Full terminal reset.
 *
 * Perform a full reset to the default values listed in
 * https://vt100.net/docs/vt510-rm/RIS.html
 */
hterm.Terminal.prototype.reset = function() {
  this.vt.reset();

  this.clearAllTabStops();
  this.setDefaultTabStops();

  this.resetColorPalette();
  const resetScreen = (screen) => {
    // We want to make sure to reset the attributes before we clear the screen.
    // The attributes might be used to initialize default/empty rows.
    screen.scrTextAttr.reset();
    screen.scrTextAttr.colorPaletteOverrides = [];
    this.clearHome(screen);
    screen.saveCursorAndState(this.vt);
  };
  resetScreen(this.primaryScreen_);
  resetScreen(this.alternateScreen_);

  // Reset terminal options to their default values.
  this.options_ = new hterm.Options();
  this.setCursorBlink('u');

  this.setVTScrollRegion(null, null);

  this.setCursorVisible(true);
};

/**
 * Soft terminal reset.
 *
 * Perform a soft reset to the default values listed in
 * http://www.vt100.net/docs/vt510-rm/DECSTR#T5-9
 */
hterm.Terminal.prototype.softReset = function() {
  this.vt.reset();

  // Reset terminal options to their default values.
  this.options_ = new hterm.Options();

  // We show the cursor on soft reset but do not alter the blink state.
  this.options_.cursorBlink = !!this.timeouts_.cursorBlink;

  this.resetColorPalette();
  const resetScreen = (screen) => {
    // Xterm also resets the color palette on soft reset, even though it doesn't
    // seem to be documented anywhere.
    screen.scrTextAttr.reset();
    screen.scrTextAttr.colorPaletteOverrides = [];
    screen.saveCursorAndState(this.vt);
  };
  resetScreen(this.primaryScreen_);
  resetScreen(this.alternateScreen_);

  // The xterm man page explicitly says this will happen on soft reset.
  this.setVTScrollRegion(null, null);

  // Xterm also shows the cursor on soft reset, but does not alter the blink
  // state.
  this.setCursorVisible(true);
};

/**
 * Move the cursor forward to the next tab stop, or to the last column
 * if no more tab stops are set.
 */
hterm.Terminal.prototype.forwardTabStop = function() {
  TMint column = this.screen_.curscol;
  TMint overflow;

  for (let i = 0; i < this.tabStops_.length; i++) {
    if (this.tabStops_[i] > column) {
      this.setCursorColumn(this.tabStops_[i]);
      return;
    }
  }

  // xterm does not clear the overflow flag on HT or CHT.
  overflow = this.screen_.cursovrfl;
  this.setCursorColumn(this.screenSize.width - 1);
  this.screen_.cursovrfl = overflow;
};

/**
 * Move the cursor backward to the previous tab stop, or to the first column
 * if no previous tab stops are set.
 */
hterm.Terminal.prototype.backwardTabStop = function() {
  TMint column = this.screen_.curscol;

  for (let i = this.tabStops_.length - 1; i >= 0; i--) {
    if (this.tabStops_[i] < column) {
      this.setCursorColumn(this.tabStops_[i]);
      return;
    }
  }

  this.setCursorColumn(1);
};

/**
 * Set a tab stop at the given column.
 *
 * @param {number} column Zero based column.
 */
hterm.Terminal.prototype.setTabStop = function(column) {
  for (let i = this.tabStops_.length - 1; i >= 0; i--) {
    if (this.tabStops_[i] == column) {
      return;
    }

    if (this.tabStops_[i] < column) {
      this.tabStops_.splice(i + 1, 0, column);
      return;
    }
  }

  this.tabStops_.splice(0, 0, column);
};

/**
 * Clear the tab stop at the current cursor position.
 *
 * No effect if there is no tab stop at the current cursor position.
 */
hterm.Terminal.prototype.clearTabStopAtCursor = function() {
  TMint column = this.screen_.curscol;

  const i = this.tabStops_.indexOf(column);
  if (i == -1) {
    return;
  }

  this.tabStops_.splice(i, 1);
};

/**
 * Clear all tab stops.
 */
hterm.Terminal.prototype.clearAllTabStops = function() {
  this.tabStops_.length = 0;
  this.defaultTabStops = false;
};

/**
 * Set up the default tab stops, starting from a given column.
 *
 * This sets a tabstop every (column % this.tabWidth) column, starting
 * from the specified column, or 0 if no column is provided.  It also flags
 * future resizes to set them up.
 *
 * This does not clear the existing tab stops first, use clearAllTabStops
 * for that.
 *
 * @param {number=} start Optional starting zero based starting column,
 *     useful for filling out missing tab stops when the terminal is resized.
 */
hterm.Terminal.prototype.setDefaultTabStops = function(start = 0) {
  const w = this.tabWidth;
  // Round start up to a default tab stop.
  start = start - 1 - ((start - 1) % w) + w;
  for (let i = start; i < this.screenSize.width; i += w) {
    this.setTabStop(i);
  }

  this.defaultTabStops = true;
};

/**
 * Interpret a sequence of characters.
 *
 * Incomplete escape sequences are buffered until the next call.
 *
 * @param {string} str Sequence of characters to interpret or pass through.
 */
hterm.Terminal.prototype.interpret = function(str) {
  this.scheduleSyncCursorPosition_();
  this.vt.interpret(str);
};

/**
 * Take over the given DIV for use as the terminal display.
 *
 * @param {!Element} div The div to use as the terminal display.
 */
hterm.Terminal.prototype.decorate = function(div) {
  const charset = div.ownerDocument.characterSet.toLowerCase();
  if (charset != 'utf-8') {
    console.warn(`Document encoding should be set to utf-8, not "${charset}";` +
                 ` Add <meta charset='utf-8'/> to your HTML <head> to fix.`);
  }

  this.div_ = div;
  this.div_.style.borderStyle = 'solid';
  this.div_.style.borderWidth = 0;
  this.div_.style.boxSizing = 'border-box';

  this.accessibilityReader_ = new hterm.AccessibilityReader(div);

  this.scroll_port.decorate(div, () => this.setupScrollPort_());
};

/**
 * Initialisation of ScrollPort properties which need to be set after its DOM
 * has been initialised.
 *
 * @private
 */
hterm.Terminal.prototype.setupScrollPort_ = function() {
  this.scroll_port.setBackgroundSize(this.prefs_.getString('background-size'));
  this.scroll_port.setBackgroundPosition(
      this.prefs_.getString('background-position'));
  this.scroll_port.setAccessibilityReader(
      lib.notNull(this.accessibilityReader_));

  this.div_.focus = this.focus.bind(this);

  this.setScrollWheelMoveMultipler(
      this.prefs_.getNumber('scroll-wheel-move-multiplier'));

  this.document_ = this.scroll_port.getDocument();
  this.accessibilityReader_.decorate(this.document_);
  this.notifications_ = new hterm.NotificationCenter(
      lib.notNull(this.document_.body), this.accessibilityReader_);

  this.document_.body.oncontextmenu = function() { return false; };

  const onMouse = this.onMouse_.bind(this);
  const screenNode = this.scroll_port.getScreenNode();
  screenNode.addEventListener(
      'mousedown', /** @type {!EventListener} */ (onMouse));
  screenNode.addEventListener(
      'mouseup', /** @type {!EventListener} */ (onMouse));
  screenNode.addEventListener(
      'mousemove', /** @type {!EventListener} */ (onMouse));
  this.scroll_port.onScrollWheel = onMouse;

  screenNode.addEventListener(
      'keydown',
      /** @type {!EventListener} */ (this.onKeyboardActivity_.bind(this)));

  screenNode.addEventListener(
      'focus', this.onFocusChange_.bind(this, true));
  // Listen for mousedown events on the screenNode as in FF the focus
  // events don't bubble.
  screenNode.addEventListener('mousedown', function() {
    setTimeout(this.onFocusChange_.bind(this, true));
  }.bind(this));

  screenNode.addEventListener(
      'blur', this.onFocusChange_.bind(this, false));

  const style = this.document_.createElement('style');
  style.textContent = `
.cursor-node[focus="false"] {
  background-color: transparent !important;
  border-color: var(--hterm-cursor-color);
  border-width: ${dpifud(2)};
  border-style: solid;
}
@keyframes cursor-blink {
  0%	{ opacity: var(--hterm-curs-opac); }
  100%	{ opacity: calc(var(--hterm-curs-opac) * 0.1); }
}
menu {
  background: #fff;
  border-radius: 4px;
  color: #202124;
  cursor: var(--hterm-mouse-cursor-pointer);
  display: none;
  filter: drop-shadow(0 1px 3px #3C40434D) drop-shadow(0 4px 8px #3C404326);
  margin: 0;
  padding: 8px 0;
  position: absolute;
  transition-duration: 200ms;
}
menuitem {
  display: block;
  font: var(--hterm-font-size) 'Roboto', 'Noto Sans', sans-serif;
  padding: 0.5em 1em;
  white-space: nowrap;
}
menuitem.separator {
  border-bottom: none;
  height: 0.5em;
  padding: 0;
}
menuitem:hover {
  background-color: #e2e4e6;
}
.wc-node {
  display: inline-block;
  text-align: center;
  width: calc(var(--hterm-charsize-width) * 2);
  line-height: var(--hterm-charsize-height);
}
:root {
  --hterm-charsize-width: ${dpifud(this.scroll_port.characterSize.width)};
  --hterm-charsize-height: ${dpifud(this.scroll_port.characterSize.height)};
  --hterm-blink-node-duration: 0.7s;
  --hterm-mouse-cursor-default: default;
  --hterm-mouse-cursor-text: text;
  --hterm-mouse-cursor-pointer: pointer;
  --hterm-mouse-cursor-style: var(--hterm-mouse-cursor-text);
  --hterm-screen-padding-size: 0;
  --hterm-curs-left: calc(
	var(--hterm-screen-padding-size)
	+ var(--hterm-charsize-width) * var(--hterm-cursor-offset-col)
  );
  --hterm-curs-top: calc(
	var(--hterm-screen-padding-size)
	+ var(--hterm-charsize-height) * var(--hterm-cursor-offset-row)
  );
  --hterm-curs-vis-factor: 1;
  --hterm-curs-opac: calc(
        var(--hterm-curs-shape-factor) * var(--hterm-curs-vis-factor)
  );

${lib.colors.stockPalette.map((c, i) => `
  --hterm-color-${i}: ${lib.colors.crackRGB(c).slice(0, 3).join(',')};
`).join('')}
}
.uri-node:hover {
  text-decoration: underline;
  cursor: var(--hterm-mouse-cursor-pointer);
}
@keyframes blink {
  from { opacity: 1.0; }
  to { opacity: 0.0; }
}
.blink-node {
  animation-name: blink;
  animation-duration: var(--hterm-blink-node-duration);
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
  animation-direction: alternate;
}`;
  // Insert this stock style as the first node so that any user styles will
  // override w/out having to use !important everywhere.  The rules above mix
  // runtime variables with default ones designed to be overridden by the user,
  // but we can wait for a concrete case from the users to determine the best
  // way to split the sheet up to before & after the user-css settings.
  this.document_.head.insertBefore(style, this.document_.head.firstChild);

  this.termCursNode = this.document_.createElement('div');
  this.termCursNode.id = 'hterm:terminal-cursor';
  this.termCursNode.className = 'cursor-node';
  this.termCursNode.style.cssText = `
animation-duration: 0.8s;
animation-name: cursor-blink;
animation-iteration-count: infinite;
animation-timing-function: cubic-bezier(1,-0.18,0,1);

box-sizing: border-box;
position: absolute;
left: var(--hterm-curs-left);
top: var(--hterm-curs-top);
width: var(--hterm-charsize-width);
height: var(--hterm-charsize-height);
opacity: var(--hterm-curs-opac);
`;

  this.setCursorColor();
  this.setCursorBlink('u');
  this.restyleCursor_();

  this.document_.body.appendChild(this.termCursNode);

  // When 'enableMouseDragScroll' is off we reposition this element directly
  // under the mouse cursor after a click.  This makes Chrome associate
  // subsequent mousemove events with the scroll-blocker.  Since the
  // scroll-blocker is a peer (not a child) of the scrollport, the mousemove
  // events do not cause the scrollport to scroll.
  //
  // It's a hack, but it's the cleanest way I could find.
  this.scrollBlockerNode_ = this.document_.createElement('div');
  this.scrollBlockerNode_.id = 'hterm:mouse-drag-scroll-blocker';
  this.scrollBlockerNode_.setAttribute('aria-hidden', 'true');
  this.scrollBlockerNode_.style.cssText =
      ('position: absolute;' +
       'top: -99px;' +
       'display: block;' +
       'width: 10px;' +
       'height: 10px;');
  this.document_.body.appendChild(this.scrollBlockerNode_);

  this.scroll_port.onScrollWheel = onMouse;
  ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick',
   ].forEach(function(event) {
       this.scrollBlockerNode_.addEventListener(event, onMouse);
       this.termCursNode.addEventListener(
           event, /** @type {!EventListener} */ (onMouse));
       this.document_.addEventListener(
           event, /** @type {!EventListener} */ (onMouse));
     }.bind(this));

  this.termCursNode.addEventListener('mousedown', function() {
      setTimeout(this.focus.bind(this));
    }.bind(this));

  this.setReverseVideo(false);

  this.scroll_port.focus();
  this.scroll_port.scheduleRedraw();
};

/**
 * Focus the terminal.
 */
hterm.Terminal.prototype.focus = function() {
  this.scroll_port.focus();
};

/**
 * Unfocus the terminal.
 */
hterm.Terminal.prototype.blur = function() {
  this.scroll_port.blur();
};

hterm.Terminal.prototype.new_row_node = function(index)
{
	const row = this.document_.createElement('x-row');
	row.appendChild(this.document_.createTextNode(''));
	row.rowIndex = index;
	return row;
};

/**
 * Return the HTML Element for a given row index.
 *
 * This is a method from the Vportctx interface.  The ScrollPort uses
 * it to fetch rows on demand as they are scrolled into view.
 *
 * TODO(rginda): Consider saving scrollback rows as (HTML source, text content)
 * pairs to conserve memory.
 *
 * @param {number} index The zero-based row index, measured relative to the
 *     start of the scrollback buffer.  On-screen rows will always have the
 *     largest indices.
 * @return {!Element} The 'x-row' element containing for the requested row.
 * @override
 */
hterm.Terminal.prototype.getRowNode = function(index)
{
	if (index < this.discarded_rows) return this.new_row_node(index);
	return this.screen_.rowsArray[index - this.discarded_rows];
};

/**
 * Return the text content for a given range of rows.
 *
 * This is a method from the Vportctx interface.  The ScrollPort uses
 * it to fetch text content on demand when the user attempts to copy their
 * selection to the clipboard.
 *
 * @param {number} start The zero-based row index to start from, measured
 *     relative to the start of the scrollback buffer.  On-screen rows will
 *     always have the largest indices.
 * @param {number} end The zero-based row index to end on, measured
 *     relative to the start of the scrollback buffer.
 * @return {string} A single string containing the text value of the range of
 *     rows.  Lines will be newline delimited, with no trailing newline.
 */
hterm.Terminal.prototype.getRowsText = function(start, end) {
  const ary = [];
  for (let i = start; i < end; i++) {
    const node = this.getRowNode(i);
    ary.push(node.textContent);
    if (i < end - 1 && !node.getAttribute('line-overflow')) {
      ary.push('\n');
    }
  }

  return ary.join('');
};

/**
 * Return the text content for a given row.
 *
 * This is a method from the Vportctx interface.  The ScrollPort uses
 * it to fetch text content on demand when the user attempts to copy their
 * selection to the clipboard.
 *
 * @param {number} index The zero-based row index to return, measured
 *     relative to the start of the scrollback buffer.  On-screen rows will
 *     always have the largest indices.
 * @return {string} A string containing the text value of the selected row.
 */
hterm.Terminal.prototype.getRowText = function(index) {
  const node = this.getRowNode(index);
  return node.textContent;
};

/**
 * Return the total number of rows in the addressable screen and in the
 * scrollback buffer of this terminal.
 *
 * This is a method from the Vportctx interface.  The ScrollPort uses
 * it to compute the size of the scrollbar.
 *
 * @return {number} The number of rows in this terminal.
 * @override
 */
hterm.Terminal.prototype.getRowCount = function() {
  return this.discarded_rows + this.screen_.rowsArray.length;
};

/**
 * Create DOM nodes for new rows and append them to the end of the terminal.
 *
 * The new row is appended to the bottom of the list of rows, and does not
 * require renumbering (of the rowIndex property) of previous rows.
 *
 * If you think you want a new blank row somewhere in the middle of the
 * terminal, look into insertRow_() or moveRows_().
 *
 * This method does not pay attention to vtScrollTop/Bottom, since you should
 * be using insertRow_() or moveRows_() in cases where they would matter.
 *
 * The cursor will be positioned at column 0 of the first inserted line.
 *
 * @param {number} count The number of rows to created.
 */
hterm.Terminal.prototype.appendRows_ = function(count) {
  let cursorRow = this.screen_.rowsArray.length;
  const offset = this.discarded_rows + cursorRow;
  for (let i = 0; i < count; i++) {
    this.screen_.pushRow(this.new_row_node(offset + i));
  }

  const extraRows = this.screen_.rowsArray.length - this.screenSize.height;
  if (extraRows > 0) {
    this.scroll_rows_off(extraRows);
    this.scheduleScrollDown_();
  }

  if (cursorRow >= this.screen_.rowsArray.length) {
    cursorRow = this.screen_.rowsArray.length - 1;
  }

  this.setAbsoluteCursorPosition(cursorRow, 0);
};

/**
 * Create a DOM node for a new row and insert it at the current position.
 *
 * The new row is inserted at the current cursor position, the existing top row
 * is moved to scrollback, and lines below are renumbered.
 *
 * The cursor will be positioned at column 0.
 */
hterm.Terminal.prototype.insertRow_ = function() {
  TMint cursorRow;

  const row = this.document_.createElement('x-row');
  row.appendChild(this.document_.createTextNode(''));

  this.scroll_rows_off(1);

  cursorRow = this.screen_.cursrow;
  this.screen_.insertRow(cursorRow, row);

  this.renumberRows_(cursorRow, this.screen_.rowsArray.length);

  this.setAbsoluteCursorPosition(cursorRow, 0);
  this.scheduleScrollDown_();
};

/**
 * Relocate rows from one part of the addressable screen to another.
 *
 * This is used to recycle rows during VT scrolls where a top region is set
 * (those which are driven by VT commands, rather than by the user manipulating
 * the scrollbar.)
 *
 * In this case, the blank lines scrolled into the scroll region are made of
 * the nodes we scrolled off.  These have their rowIndex properties carefully
 * renumbered so as not to confuse the ScrollPort.
 *
 * @param {number} fromIndex The start index.
 * @param {number} count The number of rows to move.
 * @param {number} toIndex The destination index.
 */
hterm.Terminal.prototype.moveRows_ = function(fromIndex, count, toIndex) {
  const ary = this.screen_.removeRows(fromIndex, count);
  this.screen_.insertRows(toIndex, ary);

  let start, end;
  if (fromIndex < toIndex) {
    start = fromIndex;
    end = toIndex + count;
  } else {
    start = toIndex;
    end = fromIndex + count;
  }

  this.renumberRows_(start, end);
  this.scroll_port.scheduleInvalidate();
};

/**
 * Renumber the rowIndex property of the given range of rows.
 *
 * The start and end indices are relative to the screen, not the scrollback.
 * Rows in the scrollback buffer cannot be renumbered.  Since they are not
 * addressable (you can't delete them, scroll them, etc), you should have
 * no need to renumber scrollback rows.
 *
 * @param {number} start The start index.
 * @param {number} end The end index.
 * @param {!hterm.Screen=} screen The screen to renumber.
 */
hterm.Terminal.prototype.renumberRows_ = function(
    start, end, screen = undefined) {
  if (!screen) {
    screen = this.screen_;
  }

  for (let i = start; i < end; i++) {
    screen.rowsArray[i].rowIndex = this.discarded_rows + i;
  }
};

/**
 * Print a string to the terminal.
 *
 * This respects the current insert and wraparound modes.  It will add new lines
 * to the end of the terminal, scrolling off the top into the scrollback buffer
 * if necessary.
 *
 * The string is *not* parsed for escape codes.  Use the interpret() method if
 * that's what you're after.
 *
 * @param {string} str The string to print.
 */
hterm.Terminal.prototype.print = function(str) {
  this.scheduleSyncCursorPosition_();

  // Basic accessibility output for the screen reader.
  this.accessibilityReader_.announce(str);

  let startOffset = 0;

  let strWidth = lib.wc.strWidth(str);
  // Fun edge case: If the string only contains zero width codepoints (like
  // combining characters), we make sure to iterate at least once below.
  if (strWidth == 0 && str) {
    strWidth = 1;
  }

  while (startOffset < strWidth) {
    if (this.options_.wraparound && this.screen_.cursovrfl) {
      this.screen_.commitLineOverflow();
      this.newLine(true);
    }

    let count = strWidth - startOffset;
    let didOverflow = false;
    let substr;

    if (this.screen_.curscol + count >= this.screenSize.width) {
      didOverflow = true;
      count = this.screenSize.width - this.screen_.curscol;
    }

    if (didOverflow && !this.options_.wraparound) {
      // If the string overflowed the line but wraparound is off, then the
      // last printed character should be the last of the string.
      // TODO: This will add to our problems with multibyte UTF-16 characters.
      substr = lib.wc.substr(str, startOffset, count - 1) +
          lib.wc.substr(str, strWidth - 1);
      count = strWidth;
    } else {
      substr = lib.wc.substr(str, startOffset, count);
    }

    const tokens = hterm.TextAttributes.splitWidecharString(substr);
    for (let i = 0; i < tokens.length; i++) {
      this.screen_.scrTextAttr.wcNode = tokens[i].wcNode;
      this.screen_.scrTextAttr.asciiNode = tokens[i].asciiNode;

      if (this.options_.insertMode) {
        this.screen_.insertString(tokens[i].str, tokens[i].wcStrWidth);
      } else {
        this.screen_.overwriteString(tokens[i].str, tokens[i].wcStrWidth);
      }
      this.screen_.scrTextAttr.wcNode = false;
      this.screen_.scrTextAttr.asciiNode = true;
    }

    this.screen_.maybeClipCurrentRow();
    startOffset += count;
  }
};

/**
 * Set the VT scroll region.
 *
 * This also resets the cursor position to the absolute (0, 0) position, since
 * that's what xterm appears to do.
 *
 * Setting the scroll region to the full height of the terminal will clear
 * the scroll region.  This is *NOT* what most terminals do.  We're explicitly
 * going "off-spec" here because it makes `screen` and `tmux` overflow into the
 * local scrollback buffer, which means the scrollbars and shift-pgup/pgdn
 * continue to work as most users would expect.
 *
 * @param {?number} scrotop The zero-based top of the scroll region.
 * @param {?number} scrollBottom The zero-based bottom of the scroll region,
 *     inclusive.
 */
hterm.Terminal.prototype.setVTScrollRegion = function(scrotop, scrollBottom) {
  this.vtScrollTop_ = scrotop;
  this.vtScrollBottom_ = scrollBottom;
  if (scrollBottom == this.screenSize.height - 1) {
    this.vtScrollBottom_ = null;
    if (scrotop == 0) {
      this.vtScrollTop_ = null;
    }
  }
};

/**
 * Return the top row index according to the VT.
 *
 * This will return 0 unless the terminal has been told to restrict scrolling
 * to some lower row.  It is used for some VT cursor positioning and scrolling
 * commands.
 *
 * @return {number} The topmost row in the terminal's scroll region.
 */
hterm.Terminal.prototype.getVTScrollTop = function() {
  if (this.vtScrollTop_ != null) {
    return this.vtScrollTop_;
  }

  return 0;
};

/**
 * Return the bottom row index according to the VT.
 *
 * This will return the height of the terminal unless the it has been told to
 * restrict scrolling to some higher row.  It is used for some VT cursor
 * positioning and scrolling commands.
 *
 * @return {number} The bottom most row in the terminal's scroll region.
 */
hterm.Terminal.prototype.getVTScrollBottom = function() {
  if (this.vtScrollBottom_ != null) {
    return this.vtScrollBottom_;
  }

  return this.screenSize.height - 1;
};

/**
 * Process a '\n' character.
 *
 * If the cursor is on the final row of the terminal this will append a new
 * blank row to the screen and scroll the topmost row into the scrollback
 * buffer.
 *
 * Otherwise, this moves the cursor to column zero of the next row.
 *
 * @param {boolean=} dueToOverflow Whether the newline is due to wraparound of
 *     the terminal.
 */
hterm.Terminal.prototype.newLine = function(dueToOverflow = false) {
  if (!dueToOverflow) {
    this.accessibilityReader_.newLine();
  }

  const cursorAtEndOfScreen =
      (this.screen_.cursrow == this.screen_.rowsArray.length - 1);
  const cursorAtEndOfVTRegion =
      (this.screen_.cursrow == this.getVTScrollBottom());

  if (this.vtScrollTop_ != null && cursorAtEndOfVTRegion) {
    // A VT Scroll region is active on top, we never append new rows.
    // We're at the end of the VT Scroll Region, perform a VT scroll.
    this.vtScrollUp(1);
    this.setAbsoluteCursorPosition(this.screen_.cursrow, 0);
  } else if (cursorAtEndOfScreen) {
    // We're at the end of the screen.  Append a new row to the terminal,
    // shifting the top row into the scrollback.
    this.appendRows_(1);
  } else if (cursorAtEndOfVTRegion) {
    this.insertRow_();
  } else {
    // Anywhere else in the screen just moves the cursor.
    this.setAbsoluteCursorPosition(this.screen_.cursrow + 1, 0);
  }
};

/**
 * Like newLine(), except maintain the cursor column.
 */
hterm.Terminal.prototype.lineFeed = function() {
  TMint column = this.screen_.curscol;
  this.newLine();
  this.setCursorColumn(column);
};

/**
 * If autoCarriageReturn is set then newLine(), else lineFeed().
 */
hterm.Terminal.prototype.formFeed = function() {
  if (this.options_.autoCarriageReturn) {
    this.newLine();
  } else {
    this.lineFeed();
  }
};

/**
 * Move the cursor up one row, possibly inserting a blank line.
 *
 * The cursor column is not changed.
 */
hterm.Terminal.prototype.reverseLineFeed = function() {
  TMint scrotop = this.getVTScrollTop();
  TMint currentRow = this.screen_.cursrow;

  if (currentRow == scrotop) {
    this.insertLines(1);
  } else {
    this.setAbsoluteCursorRow(currentRow - 1);
  }
};

/**
 * Replace all characters to the left of the current cursor with the space
 * character.
 *
 * TODO(rginda): This should probably *remove* the characters (not just replace
 * with a space) if there are no characters at or beyond the current cursor
 * position.
 */
hterm.Terminal.prototype.eraseToLeft = function() {
  TMint count = this.screen_.curscol + 1;
  TMint cursor = this.saveCursor();
  this.setCursorColumn(0);
  this.screen_.overwriteString(' '.repeat(count), count);
  this.restoreCursor(cursor);
};

/**
 * Erase a given number of characters to the right of the cursor.
 *
 * The cursor position is unchanged.
 *
 * If the current background color is not the default background color this
 * will insert spaces rather than delete.  This is unfortunate because the
 * trailing space will affect text selection, but it's difficult to come up
 * with a way to style empty space that wouldn't trip up the hterm.Screen
 * code.
 *
 * eraseToRight is ignored in the presence of a cursor overflow.  This deviates
 * from xterm, but agrees with gnome-terminal and konsole, xfce4-terminal.  See
 * crbug.com/232390 for details.
 *
 * @param {number=} count The number of characters to erase.
 */
hterm.Terminal.prototype.eraseToRight = function(count = undefined) {
  TMint maxCount, cursorRow;

  if (this.screen_.cursovrfl) {
    return;
  }

  maxCount = this.screenSize.width - this.screen_.curscol;
  count = count ? Math.min(count, maxCount) : maxCount;

  if (this.screen_.scrTextAttr.background ===
      this.screen_.scrTextAttr.DEFAULT_COLOR) {
    cursorRow = this.screen_.rowsArray[this.screen_.cursrow];
    if (hterm.TextAttributes.nodeWidth(cursorRow) <=
        this.screen_.curscol + count) {
      this.screen_.deleteChars(count);
      this.clearCursorOverflow();
      return;
    }
  }

  const cursor = this.saveCursor();
  this.screen_.overwriteString(' '.repeat(count), count);
  this.restoreCursor(cursor);
  this.clearCursorOverflow();
};

/**
 * Erase the current line.
 *
 * The cursor position is unchanged.
 */
hterm.Terminal.prototype.eraseLine = function() {
  const cursor = this.saveCursor();
  this.screen_.clearCursorRow();
  this.restoreCursor(cursor);
  this.clearCursorOverflow();
};

/**
 * Erase all characters from the start of the screen to the current cursor
 * position, regardless of scroll region.
 *
 * The cursor position is unchanged.
 */
hterm.Terminal.prototype.eraseAbove = function() {
  const cursor = this.saveCursor();

  this.eraseToLeft();

  for (let i = 0; i < readcursrow(cursor); i++) {
    this.setAbsoluteCursorPosition(i, 0);
    this.screen_.clearCursorRow();
  }

  this.restoreCursor(cursor);
  this.clearCursorOverflow();
};

/**
 * Erase all characters from the current cursor position to the end of the
 * screen, regardless of scroll region.
 *
 * The cursor position is unchanged.
 */
hterm.Terminal.prototype.eraseBelow = function() {
  const cursor = this.saveCursor();

  this.eraseToRight();

  const bottom = this.screenSize.height - 1;
  for (let i = readcursrow(cursor) + 1; i <= bottom; i++) {
    this.setAbsoluteCursorPosition(i, 0);
    this.screen_.clearCursorRow();
  }

  this.restoreCursor(cursor);
  this.clearCursorOverflow();
};

/**
 * Fill the terminal with a given character.
 *
 * This methods does not respect the VT scroll region.
 *
 * @param {string} ch The character to use for the fill.
 */
hterm.Terminal.prototype.fill = function(ch) {
  const cursor = this.saveCursor();

  this.setAbsoluteCursorPosition(0, 0);
  for (let row = 0; row < this.screenSize.height; row++) {
    for (let col = 0; col < this.screenSize.width; col++) {
      this.setAbsoluteCursorPosition(row, col);
      this.screen_.overwriteString(ch, 1);
    }
  }

  this.restoreCursor(cursor);
};

/**
 * Erase the entire display and leave the cursor at (0, 0).
 *
 * This does not respect the scroll region.
 *
 * @param {!hterm.Screen=} screen Optional screen to operate on.  Defaults
 *     to the current screen.
 */
hterm.Terminal.prototype.clearHome = function(screen = undefined) {
  if (!screen) {
    screen = this.screen_;
  }
  const bottom = screen.getHeight();

  this.accessibilityReader_.clear();

  if (bottom == 0) {
    // Empty screen, nothing to do.
    return;
  }

  for (let i = 0; i < bottom; i++) {
    screen.setCursorPosition(i, 0);
    screen.clearCursorRow();
  }

  screen.setCursorPosition(0, 0);
};

/**
 * Erase the entire display without changing the cursor position.
 *
 * The cursor position is unchanged.  This does not respect the scroll
 * region.
 *
 * @param {!hterm.Screen=} screen Optional screen to operate on.  Defaults
 *     to the current screen.
 */
hterm.Terminal.prototype.clear = function(screen = undefined) {
  TMint crow, ccol;

  if (!screen) {
    screen = this.screen_;
  }
  crow = screen.cursrow;
  ccol = screen.curscol;
  this.clearHome(screen);
  screen.setCursorPosition(crow, ccol);
};

/**
 * VT command to insert lines at the current cursor row.
 *
 * This respects the current scroll region.  Rows pushed off the bottom are
 * lost (they won't show up in the scrollback buffer).
 *
 * @param {number} count The number of lines to insert.
 */
hterm.Terminal.prototype.insertLines = function(count) {
  TMint cursorRow = this.screen_.cursrow;

  const bottom = this.getVTScrollBottom();
  count = Math.min(count, bottom - cursorRow);

  // The moveCount is the number of rows we need to relocate to make room for
  // the new row(s).  The count is the distance to move them.
  const moveCount = bottom - cursorRow - count + 1;
  if (moveCount) {
    this.moveRows_(cursorRow, moveCount, cursorRow + count);
  }

  for (let i = count - 1; i >= 0; i--) {
    this.setAbsoluteCursorPosition(cursorRow + i, 0);
    this.screen_.clearCursorRow();
  }
};

/**
 * VT command to delete lines at the current cursor row.
 *
 * New rows are added to the bottom of scroll region to take their place.  New
 * rows are strictly there to take up space and have no content or style.
 *
 * @param {number} count The number of lines to delete.
 */
hterm.Terminal.prototype.deleteLines = function(count) {
  TMint cursor = this.saveCursor();
  TMint top = readcursrow(cursor)

  const bottom = this.getVTScrollBottom();

  const maxCount = bottom - top + 1;
  count = Math.min(count, maxCount);

  const moveStart = bottom - count + 1;
  if (count != maxCount) {
    this.moveRows_(top, count, moveStart);
  }

  for (let i = 0; i < count; i++) {
    this.setAbsoluteCursorPosition(moveStart + i, 0);
    this.screen_.clearCursorRow();
  }

  this.restoreCursor(cursor);
  this.clearCursorOverflow();
};

/**
 * Inserts the given number of spaces at the current cursor position.
 *
 * The cursor position is not changed.
 *
 * @param {number} count The number of spaces to insert.
 */
hterm.Terminal.prototype.insertSpace = function(count) {
  const cursor = this.saveCursor();

  const ws = ' '.repeat(count || 1);
  this.screen_.insertString(ws, ws.length);
  this.screen_.maybeClipCurrentRow();

  this.restoreCursor(cursor);
  this.clearCursorOverflow();
};

/**
 * Forward-delete the specified number of characters starting at the cursor
 * position.
 *
 * @param {number} count The number of characters to delete.
 */
hterm.Terminal.prototype.deleteChars = function(count) {
  const deleted = this.screen_.deleteChars(count);
  if (deleted && !this.screen_.scrTextAttr.isDefault()) {
    const cursor = this.saveCursor();
    this.setCursorColumn(this.screenSize.width - deleted);
    this.screen_.insertString(' '.repeat(deleted));
    this.restoreCursor(cursor);
  }

  this.clearCursorOverflow();
};

/**
 * Shift rows in the scroll region upwards by a given number of lines.
 *
 * New rows are inserted at the bottom of the scroll region to fill the
 * vacated rows.  The new rows not filled out with the current text attributes.
 *
 * This function does not affect the scrollback rows at all.  Rows shifted
 * off the top are lost.
 *
 * The cursor position is not altered.
 *
 * @param {number} count The number of rows to scroll.
 */
hterm.Terminal.prototype.vtScrollUp = function(count) {
  const cursor = this.saveCursor();

  this.setAbsoluteCursorRow(this.getVTScrollTop());
  this.deleteLines(count);

  this.restoreCursor(cursor);
};

/**
 * Shift rows below the cursor down by a given number of lines.
 *
 * This function respects the current scroll region.
 *
 * New rows are inserted at the top of the scroll region to fill the
 * vacated rows.  The new rows not filled out with the current text attributes.
 *
 * This function does not affect the scrollback rows at all.  Rows shifted
 * off the bottom are lost.
 *
 * @param {number} count The number of rows to scroll.
 */
hterm.Terminal.prototype.vtScrollDown = function(count) {
  const cursor = this.saveCursor();

  this.setAbsoluteCursorPosition(this.getVTScrollTop(), 0);
  this.insertLines(count);

  this.restoreCursor(cursor);
};

/**
 * Enable accessibility-friendly features that have a performance impact.
 *
 * This will generate additional DOM nodes in an aria-live region that will
 * cause Assitive Technology to announce the output of the terminal. It also
 * enables other features that aid assistive technology. All the features gated
 * behind this flag have a performance impact on the terminal which is why they
 * are made optional.
 *
 * @param {boolean} enabled Whether to enable accessibility-friendly features.
 */
hterm.Terminal.prototype.setAccessibilityEnabled = function(enabled) {
  this.accessibilityReader_.setAccessibilityEnabled(enabled);
};

/**
 * Set the cursor position.
 *
 * The cursor row is relative to the scroll region if the terminal has
 * 'origin mode' enabled, or relative to the addressable screen otherwise.
 *
 * @param {number} row The new zero-based cursor row.
 * @param {number} column The new zero-based cursor column.
 */
hterm.Terminal.prototype.setCursorPosition = function(row, column) {
  if (this.options_.originMode) {
    this.setRelativeCursorPosition(row, column);
  } else {
    this.setAbsoluteCursorPosition(row, column);
  }
};

/**
 * Move the cursor relative to its current position.
 *
 * @param {number} row
 * @param {number} column
 */
hterm.Terminal.prototype.setRelativeCursorPosition = function(row, column) {
  const scrotop = this.getVTScrollTop();
  row = rangefit(row + scrotop, scrotop, this.getVTScrollBottom());
  column = rangefit(column, 0, this.screenSize.width - 1);
  this.screen_.setCursorPosition(row, column);
};

/**
 * Move the cursor to the specified position.
 *
 * @param {number} row
 * @param {number} column
 */
hterm.Terminal.prototype.setAbsoluteCursorPosition = function(row, column) {
  row = rangefit(row, 0, this.screenSize.height - 1);
  column = rangefit(column, 0, this.screenSize.width - 1);
  this.screen_.setCursorPosition(row, column);
};

/**
 * Set the cursor column.
 *
 * @param {number} column The new zero-based cursor column.
 */
hterm.Terminal.prototype.setCursorColumn = function(column) {
  this.setAbsoluteCursorPosition(this.screen_.cursrow, column);
};

/**
 * Return the cursor column.
 *
 * @return {number} The zero-based cursor column.
 */
hterm.Terminal.prototype.getCursorColumn = function() {
  return this.screen_.curscol;
};

/**
 * Set the cursor row.
 *
 * The cursor row is relative to the scroll region if the terminal has
 * 'origin mode' enabled, or relative to the addressable screen otherwise.
 *
 * @param {number} row The new cursor row.
 */
hterm.Terminal.prototype.setAbsoluteCursorRow = function(row) {
  this.setAbsoluteCursorPosition(row, this.screen_.curscol);
};

/**
 * Return the cursor row.
 *
 * @return {number} The zero-based cursor row.
 */
hterm.Terminal.prototype.getCursorRow = function() {
  return this.screen_.cursrow;
};

/**
 * Request that the ScrollPort redraw itself soon.
 *
 * The redraw will happen asynchronously, soon after the call stack winds down.
 * Multiple calls will be coalesced into a single redraw.
 */
hterm.Terminal.prototype.scheduleRedraw_ = function() {
  if (this.timeouts_.redraw) {
    return;
  }

  this.timeouts_.redraw = setTimeout(() => {
    delete this.timeouts_.redraw;
    this.scroll_port.redraw_();
  });
};

/**
 * Request that the ScrollPort be scrolled to the bottom.
 *
 * The scroll will happen asynchronously, soon after the call stack winds down.
 * Multiple calls will be coalesced into a single scroll.
 *
 * This affects the scrollbar position of the ScrollPort, and has nothing to
 * do with the VT scroll commands.
 */
hterm.Terminal.prototype.scheduleScrollDown_ = function() {
  if (this.timeouts_.scrollDown) {
    return;
  }

  this.timeouts_.scrollDown = setTimeout(() => {
    delete this.timeouts_.scrollDown;
    this.scroll_port.scrollRowToBottom(this.getRowCount());
  }, 10);
};

/**
 * Move the cursor up a specified number of rows.
 *
 * @param {number} count The number of rows to move the cursor.
 */
hterm.Terminal.prototype.cursorUp = function(count) {
  this.cursorDown(-(count || 1));
};

/**
 * Move the cursor down a specified number of rows.
 *
 * @param {number} count The number of rows to move the cursor.
 */
hterm.Terminal.prototype.cursorDown = function(count) {
  TMint row;

  count = count || 1;
  const minHeight = (this.options_.originMode ? this.getVTScrollTop() : 0);
  const maxHeight = (this.options_.originMode ? this.getVTScrollBottom() :
                     this.screenSize.height - 1);

  row = rangefit(this.screen_.cursrow + count, minHeight, maxHeight);
  this.setAbsoluteCursorRow(row);
};

/**
 * Move the cursor left a specified number of columns.
 *
 * If reverse wraparound mode is enabled and the previous row wrapped into
 * the current row then we back up through the wraparound as well.
 *
 * @param {number} count The number of columns to move the cursor.
 */
hterm.Terminal.prototype.cursorLeft = function(count) {
  TMint currentColumn, newRow;

  count = count || 1;

  if (count < 1) {
    return;
  }

  currentColumn = this.screen_.curscol;
  if (this.options_.reverseWraparound) {
    if (this.screen_.cursovrfl) {
      // If this cursor is in the right margin, consume one count to get it
      // back to the last column.  This only applies when we're in reverse
      // wraparound mode.
      count--;
      this.clearCursorOverflow();

      if (!count) {
        return;
      }
    }

    newRow = this.screen_.cursrow;
    let newColumn = currentColumn - count;
    if (newColumn < 0) {
      newRow = newRow - Math.floor(count / this.screenSize.width) - 1;
      if (newRow < 0) {
        // xterm also wraps from row 0 to the last row.
        newRow = this.screenSize.height + newRow % this.screenSize.height;
      }
      newColumn = this.screenSize.width + newColumn % this.screenSize.width;
    }

    this.setCursorPosition(Math.max(newRow, 0), newColumn);

  } else {
    const newColumn = Math.max(currentColumn - count, 0);
    this.setCursorColumn(newColumn);
  }
};

/**
 * Move the cursor right a specified number of columns.
 *
 * @param {number} count The number of columns to move the cursor.
 */
hterm.Terminal.prototype.cursorRight = function(count) {
  TMint column;

  count = count || 1;

  if (count < 1) {
    return;
  }

  column = rangefit(this.screen_.curscol + count,
                       0, this.screenSize.width - 1);
  this.setCursorColumn(column);
};

/**
 * Reverse the foreground and background colors of the terminal.
 *
 * This only affects text that was drawn with no attributes.
 *
 * TODO(rginda): Test xterm to see if reverse is respected for text that has
 * been drawn with attributes that happen to coincide with the default
 * 'no-attribute' colors.  My guess is probably not.
 *
 * @param {boolean} state The state to set.
 */
hterm.Terminal.prototype.setReverseVideo = function(state) {
  this.options_.reverseVideo = state;
  if (state) {
    this.setRgbColorCssVar('foreground-color', this.backgroundColor_);
    this.setRgbColorCssVar('background-color', this.foregroundColor_);
  } else {
    this.setRgbColorCssVar('foreground-color', this.foregroundColor_);
    this.setRgbColorCssVar('background-color', this.backgroundColor_);
  }
};

/**
 * Ring the terminal bell.
 *
 * This will not play the bell audio more than once per second.
 */
hterm.Terminal.prototype.ringBell = function() {
  this.termCursNode.style.backgroundColor = 'rgb(var(--hterm-foreground-color))';
  this.termCursNode.style.animationName = '';

  setTimeout(() => this.restyleCursor_(), 500);

  if (this.desktopNotificationBell_ && !this.document_.hasFocus()) {
    const n = hterm.notify();
    this.bellNotificationList_.push(n);
    // TODO: Should we try to raise the window here?
    n.onclick = () => this.closeBellNotifications_();
  }
};

/**
 * Set the origin mode bit.
 *
 * If origin mode is on, certain VT cursor and scrolling commands measure their
 * row parameter relative to the VT scroll region.  Otherwise, row 0 corresponds
 * to the top of the addressable screen.
 *
 * Defaults to off.
 *
 * @param {boolean} state True to set origin mode, false to unset.
 */
hterm.Terminal.prototype.setOriginMode = function(state) {
  this.options_.originMode = state;
  this.setCursorPosition(0, 0);
};

/**
 * Set the insert mode bit.
 *
 * If insert mode is on, existing text beyond the cursor position will be
 * shifted right to make room for new text.  Otherwise, new text overwrites
 * any existing text.
 *
 * Defaults to off.
 *
 * @param {boolean} state True to set insert mode, false to unset.
 */
hterm.Terminal.prototype.setInsertMode = function(state) {
  this.options_.insertMode = state;
};

/**
 * Set the auto carriage return bit.
 *
 * If auto carriage return is on then a formfeed character is interpreted
 * as a newline, otherwise it's the same as a linefeed.  The difference boils
 * down to whether or not the cursor column is reset.
 *
 * @param {boolean} state The state to set.
 */
hterm.Terminal.prototype.setAutoCarriageReturn = function(state) {
  this.options_.autoCarriageReturn = state;
};

/**
 * Set the wraparound mode bit.
 *
 * If wraparound mode is on, certain VT commands will allow the cursor to wrap
 * to the start of the following row.  Otherwise, the cursor is clamped to the
 * end of the screen and attempts to write past it are ignored.
 *
 * Defaults to on.
 *
 * @param {boolean} state True to set wraparound mode, false to unset.
 */
hterm.Terminal.prototype.setWraparound = function(state) {
  this.options_.wraparound = state;
};

/**
 * Set the reverse-wraparound mode bit.
 *
 * If wraparound mode is off, certain VT commands will allow the cursor to wrap
 * to the end of the previous row.  Otherwise, the cursor is clamped to column
 * 0.
 *
 * Defaults to off.
 *
 * @param {boolean} state True to set reverse-wraparound mode, false to unset.
 */
hterm.Terminal.prototype.setReverseWraparound = function(state) {
  this.options_.reverseWraparound = state;
};

/**
 * Selects between the primary and alternate screens.
 *
 * If alternate mode is on, the alternate screen is active.  Otherwise the
 * primary screen is active.
 *
 * Swapping screens has no effect on the scrollback buffer.
 *
 * Each screen maintains its own cursor position.
 *
 * Defaults to off.
 *
 * @param {boolean} state True to set alternate mode, false to unset.
 */
hterm.Terminal.prototype.setAlternateMode = function(state) {
  if (state == (this.screen_ == this.alternateScreen_)) {
    return;
  }
  const oldOverrides = this.screen_.scrTextAttr.colorPaletteOverrides;
  const cursor = this.saveCursor();
  this.screen_ = state ? this.alternateScreen_ : this.primaryScreen_;

  // Swap color overrides.
  const newOverrides = this.screen_.scrTextAttr.colorPaletteOverrides;
  oldOverrides.forEach((c, i) => {
    if (!newOverrides.hasOwnProperty(i)) {
      this.setRgbColorCssVar(`color-${i}`, this.getColorPalette(i));
    }
  });
  newOverrides.forEach((c, i) => this.setRgbColorCssVar(`color-${i}`, c));

  if (this.screen_.rowsArray.length &&
      this.screen_.rowsArray[0].rowIndex != this.discarded_rows) {
    // If the screen changed sizes while we were away, our rowIndexes may
    // be incorrect.
    const offset = this.discarded_rows;
    const ary = this.screen_.rowsArray;
    for (let i = 0; i < ary.length; i++) {
      ary[i].rowIndex = offset + i;
    }
  }

  // NB: We specifically do not use realizeSize_ because that's optimized to
  // elide updates when the size is the same which is the most common scenario
  // at this point.  We need the other cascading changes from switching the
  // underlying screen to be processed.
  this.realizeWidth_(this.screenSize.width);
  this.realizeHeight_(this.screenSize.height);
  this.scroll_port.syncScrollHeight();
  this.scroll_port.invalidate();

  this.restoreCursor(cursor);
  this.scroll_port.resize();
};

/**
 * Set the cursor-blink mode bit.
 *
 * 'p' - pauses blink if it's on
 * 'r' - resumes blink from normal state
 * 'u' - set according to user preference
 * 'y' - turn on
 * 'n' - turn off
 */
hterm.Terminal.prototype.setCursorBlink = function(b) {
  var temp, perm = this.options_.cursorBlink;

  switch (b) {
  case 'p': temp = 0;		break;
  case 'r': temp = perm;	break;
  case 'u':
  case 'y': temp = perm = 1;	break;
  case 'n': temp = perm = 0;	break;

  default: throw 'invalid blink: ' + b;
  }

  this.options_.cursorBlink = !!perm;
  this.termCursNode.style.animationName = temp ? 'cursor-blink' : '';
};

/**
 * Set the cursor-visible mode bit.
 *
 * If cursor-visible is on, the cursor will be visible.  Otherwise it will not.
 *
 * Defaults to on.
 *
 * @param {boolean} state True to set cursor-visible mode, false to unset.
 */
hterm.Terminal.prototype.setCursorVisible = function(state) {
  this.setCssVar('curs-vis-factor', state ? '1.0' : '0.25');
};

/**
 * Synchronizes the visible cursor and document selection with the current
 * cursor coordinates.
 *
 * @return {boolean} True if the cursor is onscreen and synced.
 */
hterm.Terminal.prototype.syncCursorPosition_ = function() {
  TMint cursorColumnIndex, topRowIndex, bottomRowIndex, cursorRowIndex;

  topRowIndex = this.scroll_port.getTopRowIndex();
  bottomRowIndex = this.scroll_port.getBottomRowIndex(topRowIndex);
  cursorRowIndex = this.discarded_rows + this.screen_.cursrow;

  let forceSyncSelection = false;
  if (this.accessibilityReader_.accessibilityEnabled) {
    // Report the new position of the cursor for accessibility purposes.
    cursorColumnIndex = this.screen_.curscol;
    const cursorLineText =
        this.screen_.rowsArray[this.screen_.cursrow].innerText;
    // This will force the selection to be sync'd to the cursor position if the
    // user has pressed a key. Generally we would only sync the cursor position
    // when selection is collapsed so that if the user has selected something
    // we don't clear the selection by moving the selection. However when a
    // screen reader is used, it's intuitive for entering a key to move the
    // selection to the cursor.
    forceSyncSelection = this.accessibilityReader_.hasUserGesture;
    this.accessibilityReader_.afterCursorChange(
        cursorLineText, cursorRowIndex, cursorColumnIndex);
  }

  if (cursorRowIndex > bottomRowIndex) {
    // Cursor is scrolled off screen, hide it.
    this.cursorOffScreen_ = true;
    this.termCursNode.style.display = 'none';
    return false;
  }

  if (this.termCursNode.style.display == 'none') {
    // Re-display the terminal cursor if it was hidden.
    this.cursorOffScreen_ = false;
    this.termCursNode.style.display = '';
  }

  // Position the cursor using CSS variable math.  If we do the math in JS,
  // the float math will end up being more precise than the CSS which will
  // cause the cursor tracking to be off.
  this.setCssVar(
      'cursor-offset-row',
      `${cursorRowIndex - topRowIndex + this.scroll_port.visibleRowTopMargin}`);
  this.setCssVar('cursor-offset-col', this.screen_.curscol);

  this.termCursNode.setAttribute('title',
                                '(' + this.screen_.curscol +
                                ', ' + this.screen_.cursrow +
                                ')');

  // Update the caret for a11y purposes.
  const selection = this.document_.getSelection();
  if (selection && (selection.isCollapsed || forceSyncSelection)) {
    this.screen_.syncSelectionCaret(selection);
  }
  return true;
};

/**
 * Adjusts the style of this.termCursNode according to the current cursor shape
 * and character cell dimensions.
 */
hterm.Terminal.prototype.restyleCursor_ = function() {
  let shape = this.cursorShape_;

  const style = this.termCursNode.style;

  if (this.termCursNode.getAttribute('focus') == 'false') {
    // Always show a block cursor when unfocused.
    shape = 'b';
    this.setCursorBlink('p');
  }
  else {
    this.setCursorBlink('r');
  }

  switch (shape) {
    case '|':
      style.borderColor = 'var(--hterm-cursor-color)';
      this.setCssVar('curs-shape-factor', 0.9);
      style.backgroundColor = 'transparent';
      style.borderBottomStyle = '';
      style.borderLeftStyle = 'solid';
      break;

    case '_':
      style.borderColor = 'var(--hterm-cursor-color)';
      this.setCssVar('curs-shape-factor', 0.9);
      style.backgroundColor = 'transparent';
      style.borderBottomStyle = 'solid';
      style.borderLeftStyle = '';
      break;

    case 'b':
      style.backgroundColor = 'var(--hterm-cursor-color)';
      this.setCssVar('curs-shape-factor', 0.6);
      style.borderBottomStyle = '';
      style.borderLeftStyle = '';
      break;
  }
};

/**
 * Synchronizes the visible cursor with the current cursor coordinates.
 *
 * The sync will happen asynchronously, soon after the call stack winds down.
 * Multiple calls will be coalesced into a single sync. This should be called
 * prior to the cursor actually changing position.
 */
hterm.Terminal.prototype.scheduleSyncCursorPosition_ = function() {
  TMint cursorColumnIndex;

  if (this.timeouts_.syncCursor) {
    return;
  }

  if (this.accessibilityReader_.accessibilityEnabled) {
    // Report the previous position of the cursor for accessibility purposes.
    const cursorRowIndex = this.discarded_rows +
        this.screen_.cursrow;
    cursorColumnIndex = this.screen_.curscol;
    const cursorLineText =
        this.screen_.rowsArray[this.screen_.cursrow].innerText;
    this.accessibilityReader_.beforeCursorChange(
        cursorLineText, cursorRowIndex, cursorColumnIndex);
  }

  this.timeouts_.syncCursor = setTimeout(() => {
    this.syncCursorPosition_();
    delete this.timeouts_.syncCursor;
  });
};

/**
 * Show the terminal overlay.
 *
 * @see hterm.NotificationCenter.show
 * @param {string|!Node} msg The message to display.
 * @param {?number=} timeout How long to time to wait before hiding.
 */
hterm.Terminal.prototype.showOverlay = function(msg, timeout = 1500) {
  if (!this.ready_ || !this.notifications_) {
    return;
  }

  this.notifications_.show(msg, {timeout});
};

/**
 * Hide the terminal overlay immediately.
 *
 * @see hterm.NotificationCenter.hide
 */
hterm.Terminal.prototype.hideOverlay = function() {
  this.notifications_.hide();
};

/**
 * Paste from the system clipboard to the terminal.
 *
 * Note: In Chrome, this should work unless the user has rejected the permission
 * request. In Firefox extension environment, you'll need the "clipboardRead"
 * permission.  In other environments, this might always fail as the browser
 * frequently blocks access for security reasons.
 *
 * @return {?boolean} If nagivator.clipboard.readText is available, the return
 *     value is always null. Otherwise, this function uses legacy pasting and
 *     returns a boolean indicating whether it is successful.
 */
hterm.Terminal.prototype.paste = function() {
  if (!this.alwaysUseLegacyPasting &&
      navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then((data) => this.onPasteData_(data));
    return null;
  } else {
    // Legacy pasting.
    try {
      return this.document_.execCommand('paste');
    } catch (firefoxException) {
      // Ignore this.  FF 40 and older would incorrectly throw an exception if
      // there was an error instead of returning false.
      return false;
    }
  }
};

/**
 * Copy a string to the system clipboard.
 *
 * Note: If there is a selected range in the terminal, it'll be cleared.
 *
 * @param {string} str The string to copy.
 */
hterm.Terminal.prototype.copyStringToClipboard = function(str) {
  if (this.prefs_.get('enable-clipboard-notice')) {
    if (!this.clipboardNotice_) {
      this.clipboardNotice_ = this.document_.createElement('div');
      this.clipboardNotice_.style.textAlign = 'center';
      const copyImage = lib.resource.getData('hterm/images/copy');
      this.clipboardNotice_.innerHTML = hterm.sanitizeHtml(
          `${copyImage}<div>${hterm.msg('NOTIFY_COPY', [], 'copied!')}</div>`);
    }
    setTimeout(() => this.showOverlay(this.clipboardNotice_, 500), 200);
  }

  hterm.copySelectionToClipboard(this.document_, str);
};

/**
 * Display an image.
 *
 * Either URI or buffer or blob fields must be specified.
 *
 * @param {{
 *     name: (string|undefined),
 *     size: (string|number|undefined),
 *     preserveAspectRation: (boolean|undefined),
 *     inline: (boolean|undefined),
 *     width: (string|number|undefined),
 *     height: (string|number|undefined),
 *     align: (string|undefined),
 *     url: (string|undefined),
 *     buffer: (!ArrayBuffer|undefined),
 *     blob: (!Blob|undefined),
 *     type: (string|undefined),
 * }} options The image to display.
 *   name A human readable string for the image
 *   size The size (in bytes).
 *   preserveAspectRatio Whether to preserve aspect.
 *   inline Whether to display the image inline.
 *   width The width of the image.
 *   height The height of the image.
 *   align Direction to align the image.
 *   uri The source URI for the image.
 *   buffer The ArrayBuffer image data.
 *   blob The Blob image data.
 *   type The MIME type of the image data.
 * @param {function()=} onLoad Callback when loading finishes.
 * @param {function(!Event)=} onError Callback when loading fails.
 */
hterm.Terminal.prototype.displayImage = function(options, onLoad, onError) {
  // Make sure we're actually given a resource to display.
  if (options.uri === undefined && options.buffer === undefined &&
      options.blob === undefined) {
    return;
  }

  // Set up the defaults to simplify code below.
  if (!options.name) {
    options.name = '';
  }

  // See if the mime type is available.  If not, guess from the filename.
  // We don't list all possible mime types because the browser can usually
  // guess it correctly.  So list the ones that need a bit more help.
  if (!options.type) {
    const ary = options.name.split('.');
    const ext = ary[ary.length - 1].trim();
    switch (ext) {
      case 'svg':
      case 'svgz':
        options.type = 'image/svg+xml';
        break;
    }
  }

  // Has the user approved image display yet?
  if (this.allowImagesInline !== true) {
    if (this.allowImagesInline === false) {
      this.showOverlay(hterm.msg('POPUP_INLINE_IMAGE_DISABLED', [],
                       'Inline Images Disabled'));
      return;
    }

    // Show a prompt.
    let button;
    const span = this.document_.createElement('span');

    const label = this.document_.createElement('p');
    label.innerText = hterm.msg('POPUP_INLINE_IMAGE', [], 'Inline Images');
    label.style.textAlign = 'center';
    span.appendChild(label);

    button = this.document_.createElement('input');
    button.type = 'button';
    button.value = hterm.msg('BUTTON_BLOCK', [], 'block');
    button.addEventListener('click', () => {
      this.prefs_.set('allow-images-inline', false);
      this.hideOverlay();
    });
    span.appendChild(button);

    span.appendChild(new Text(' '));

    button = this.document_.createElement('input');
    button.type = 'button';
    button.value = hterm.msg('BUTTON_ALLOW_SESSION', [], 'allow this session');
    button.addEventListener('click', () => {
      this.allowImagesInline = true;
      this.hideOverlay();
    });
    span.appendChild(button);

    span.appendChild(new Text(' '));

    button = this.document_.createElement('input');
    button.type = 'button';
    button.value = hterm.msg('BUTTON_ALLOW_ALWAYS', [], 'always allow');
    button.addEventListener('click', () => {
      this.prefs_.set('allow-images-inline', true);
      this.hideOverlay();
    });
    span.appendChild(button);

    this.showOverlay(span, null);
    return;
  }

  // See if we should show this object directly, or download it.
  if (options.inline) {
    const io = this.io.push();
    io.showOverlay(hterm.msg('LOADING_RESOURCE_START', [options.name],
                             'Loading $1 ...'));

    // While we're loading the image, eat all the user's input.
    io.sendString = () => {};

    // Initialize this new image.
    const img = this.document_.createElement('img');
    if (options.uri !== undefined) {
      img.src = options.uri;
    } else if (options.buffer !== undefined) {
      const blob = new Blob([options.buffer], {type: options.type});
      img.src = URL.createObjectURL(blob);
    } else {
      const blob = new Blob([options.blob], {type: options.type});
      img.src = URL.createObjectURL(blob);
    }
    img.title = img.alt = options.name;

    // Attach the image to the page to let it load/render.  It won't stay here.
    // This is needed so it's visible and the DOM can calculate the height.  If
    // the image is hidden or not in the DOM, the height is always 0.
    this.document_.body.appendChild(img);

    // Wait for the image to finish loading before we try moving it to the
    // right place in the terminal.
    img.onload = () => {
      // Now that we have the image dimensions, figure out how to show it.
      const screenSize = this.scroll_port.getScreenSize();
      img.style.objectFit = options.preserveAspectRatio ? 'scale-down' : 'fill';
      img.style.maxWidth = `${screenSize.width}px`;
      img.style.maxHeight = `${screenSize.height}px`;

      // Parse a width/height specification.
      const parseDim = (dim, maxDim, cssVar) => {
        if (!dim || dim == 'auto') {
          return '';
        }

        const ary = dim.match(/^([0-9]+)(px|%)?$/);
        if (ary) {
          if (ary[2] == '%') {
            return Math.floor(maxDim * ary[1] / 100) + 'px';
          } else if (ary[2] == 'px') {
            return dim;
          } else {
            return `calc(${dim} * var(${cssVar}))`;
          }
        }

        return '';
      };
      img.style.width = parseDim(
          options.width, screenSize.width, '--hterm-charsize-width');
      img.style.height = parseDim(
          options.height, screenSize.height, '--hterm-charsize-height');

      // Figure out how many rows the image occupies, then add that many.
      // Note: This count will be inaccurate if the font size changes on us.
      const padRows = Math.ceil(img.clientHeight /
                                this.scroll_port.characterSize.height);
      for (let i = 0; i < padRows; ++i) {
        this.newLine();
      }

      // Update the max height in case the user shrinks the character size.
      img.style.maxHeight = `calc(${padRows} * var(--hterm-charsize-height))`;

      // Move the image to the last row.  This way when we scroll up, it doesn't
      // disappear when the first row gets clipped.  It will disappear when we
      // scroll down and the last row is clipped ...
      this.document_.body.removeChild(img);
      // Create a wrapper node so we can do an absolute in a relative position.
      // This helps with rounding errors between JS & CSS counts.
      const div = this.document_.createElement('div');
      div.style.position = 'relative';
      div.style.textAlign = options.align || '';
      img.style.position = 'absolute';
      img.style.bottom = 'calc(0px - var(--hterm-charsize-height))';
      div.appendChild(img);
      const row = this.getRowNode(this.discarded_rows +
                                  this.getCursorRow() - 1);
      row.appendChild(div);

      // Now that the image has been read, we can revoke the source.
      if (options.uri === undefined) {
        URL.revokeObjectURL(img.src);
      }

      io.hideOverlay();
      io.pop();

      if (onLoad) {
        onLoad();
      }
    };

    // If we got a malformed image, give up.
    img.onerror = (e) => {
      this.document_.body.removeChild(img);
      io.showOverlay(hterm.msg('LOADING_RESOURCE_FAILED', [options.name],
                               'Loading $1 failed'));
      io.pop();

      if (onError) {
        onError(e);
      }
    };
  } else {
    // We can't use chrome.downloads.download as that requires "downloads"
    // permissions, and that works only in extensions, not apps.
    const a = this.document_.createElement('a');
    if (options.uri !== undefined) {
      a.href = options.uri;
    } else if (options.buffer !== undefined) {
      const blob = new Blob([options.buffer]);
      a.href = URL.createObjectURL(blob);
    } else {
      a.href = URL.createObjectURL(lib.notNull(options.blob));
    }
    a.download = options.name;
    this.document_.body.appendChild(a);
    a.click();
    a.remove();
    if (options.uri === undefined) {
      URL.revokeObjectURL(a.href);
    }
  }
};

/**
 * Returns the selected text, or null if no text is selected.
 *
 * @return {string|null}
 */
hterm.Terminal.prototype.getSelectionText = function() {
  const selection = this.scroll_port.selection;
  selection.sync();

  if (selection.isCollapsed) {
    return null;
  }

  // Start offset measures from the beginning of the line.
  let startOffset = selection.startOffset;
  let node = selection.startNode;

  // If an x-row isn't selected, |node| will be null.
  if (!node) {
    return null;
  }

  if (node.nodeName != 'X-ROW') {
    // If the selection doesn't start on an x-row node, then it must be
    // somewhere inside the x-row.  Add any characters from previous siblings
    // into the start offset.

    if (node.nodeName == '#text' && node.parentNode.nodeName == 'SPAN') {
      // If node is the text node in a styled span, move up to the span node.
      node = node.parentNode;
    }

    while (node.previousSibling) {
      node = node.previousSibling;
      startOffset += hterm.TextAttributes.nodeWidth(node);
    }
  }

  // End offset measures from the end of the line.
  let endOffset =
      hterm.TextAttributes.nodeWidth(lib.notNull(selection.endNode)) -
      selection.endOffset;
  node = selection.endNode;

  if (node.nodeName != 'X-ROW') {
    // If the selection doesn't end on an x-row node, then it must be
    // somewhere inside the x-row.  Add any characters from following siblings
    // into the end offset.

    if (node.nodeName == '#text' && node.parentNode.nodeName == 'SPAN') {
      // If node is the text node in a styled span, move up to the span node.
      node = node.parentNode;
    }

    while (node.nextSibling) {
      node = node.nextSibling;
      endOffset += hterm.TextAttributes.nodeWidth(node);
    }
  }

  const rv = this.getRowsText(selection.startRow.rowIndex,
                              selection.endRow.rowIndex + 1);
  return lib.wc.substring(rv, startOffset, lib.wc.strWidth(rv) - endOffset);
};

/**
 * Copy the current selection to the system clipboard, then clear it after a
 * short delay.
 */
hterm.Terminal.prototype.copySelectionToClipboard = function() {
  const text = this.getSelectionText();
  if (text != null) {
    this.copyStringToClipboard(text);
  }
};

/**
 * Show overlay with current terminal size.
 */
hterm.Terminal.prototype.overlaySize = function() {
  if (this.prefs_.get('enable-resize-status')) {
    this.showOverlay(`${this.screenSize.width} × ${this.screenSize.height}`);
  }
};

/**
 * Manage the automatic mouse hiding behavior while typing.
 *
 * @param {?boolean=} v Whether to enable automatic hiding.
 */
hterm.Terminal.prototype.setAutomaticMouseHiding = function(v = null) {
  // Since ChromeOS & macOS do this by default everywhere, we don't need to.
  // Linux & Windows seem to leave this to specific applications to manage.
  if (v === null) {
    v = (hterm.os != 'cros' && hterm.os != 'mac');
  }

  this.mouseHideWhileTyping_ = !!v;
};

/**
 * Handler for monitoring user keyboard activity.
 *
 * This isn't for processing the keystrokes directly, but for updating any
 * state that might toggle based on the user using the keyboard at all.
 *
 * @param {!KeyboardEvent} e The keyboard event that triggered us.
 */
hterm.Terminal.prototype.onKeyboardActivity_ = function(e) {
  // When the user starts typing, hide the mouse cursor.
  if (this.mouseHideWhileTyping_ && !this.mouseHideDelay_) {
    this.setCssVar('mouse-cursor-style', 'none');
  }
};

/**
 * Add the terminalRow and terminalColumn properties to mouse events and
 * then forward on to onMouse().
 *
 * The terminalRow and terminalColumn properties contain the (row, column)
 * coordinates for the mouse event.
 *
 * @param {!MouseEvent} e The mouse event to handle.
 */
hterm.Terminal.prototype.onMouse_ = function(e) {
  if (e.processedByTerminalHandler_) {
    // We register our event handlers on the document, as well as the cursor
    // and the scroll blocker.  Mouse events that occur on the cursor or
    // scroll blocker will also appear on the document, but we don't want to
    // process them twice.
    //
    // We can't just prevent bubbling because that has other side effects, so
    // we decorate the event object with this property instead.
    return;
  }

  // Consume navigation events.  Button 3 is usually "browser back" and
  // button 4 is "browser forward" which we don't want to happen.
  if (e.button > 2) {
    e.preventDefault();
    // We don't return so click events can be passed to the remote below.
  }

  const reportMouseEvents = (!this.defeatMouseReports_ &&
      this.vt.mouseReport != this.vt.MOUSE_REPORT_DISABLED);

  e.processedByTerminalHandler_ = true;

  // Handle auto hiding of mouse cursor while typing.
  if (this.mouseHideWhileTyping_ && !this.mouseHideDelay_) {
    // Make sure the mouse cursor is visible.
    this.syncMouseStyle();
    // This debounce isn't perfect, but should work well enough for such a
    // simple implementation.  If the user moved the mouse, we enabled this
    // debounce, and then moved the mouse just before the timeout, we wouldn't
    // debounce that later movement.
    this.mouseHideDelay_ = setTimeout(() => this.mouseHideDelay_ = null, 1000);
  }

  // One based row/column stored on the mouse event.
  const padding = this.scroll_port.screenPaddingSize;
  e.terminalRow = Math.floor(
      (e.clientY - this.scroll_port.visibleRowTopMargin - padding) /
      this.scroll_port.characterSize.height) + 1;
  e.terminalColumn = Math.floor(
      (e.clientX - padding) / this.scroll_port.characterSize.width) + 1;

  // Clamp row and column.
  e.terminalRow = rangefit(e.terminalRow, 1, this.screenSize.height);
  e.terminalColumn = rangefit(e.terminalColumn, 1, this.screenSize.width);

  if (!reportMouseEvents && !this.cursorOffScreen_) {
    // If the cursor is visible and we're not sending mouse events to the
    // host app, then we want to hide the terminal cursor when the mouse
    // cursor is over top.  This keeps the terminal cursor from interfering
    // with local text selection.
    if (e.terminalRow - 1 == this.screen_.cursrow &&
        e.terminalColumn - 1 == this.screen_.curscol) {
      this.termCursNode.style.display = 'none';
    } else if (this.termCursNode.style.display == 'none') {
      this.termCursNode.style.display = '';
    }
  }

  if (e.type == 'mousedown') {
    if (e.altKey || !reportMouseEvents) {
      // If VT mouse reporting is disabled, or has been defeated with
      // alt-mousedown, then the mouse will act on the local selection.
      this.defeatMouseReports_ = true;
      this.setSelectionEnabled(true);
    } else {
      // Otherwise we defer ownership of the mouse to the VT.
      this.defeatMouseReports_ = false;
      this.document_.getSelection().collapseToEnd();
      this.setSelectionEnabled(false);
      e.preventDefault();
    }
  }

  if (!reportMouseEvents) {
    if (e.type == 'dblclick') {
      this.screen_.expandSelection(this.document_.getSelection());
      if (this.copyOnSelect) {
        this.copySelectionToClipboard();
      }
    }

    // Handle clicks to open links automatically.
    if (e.type == 'click' && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
      // Ignore links created using OSC-8 as those will open by themselves, and
      // the visible text is most likely not the URI they want anyways.
      if (e.target.className === 'uri-node') {
        return;
      }

      // Debounce this event with the dblclick event.  If you try to doubleclick
      // a URL to open it, Chrome will fire click then dblclick, but we won't
      // have expanded the selection text at the first click event.
      clearTimeout(this.timeouts_.openUrl);
      this.timeouts_.openUrl = setTimeout(this.openSelectedUrl_.bind(this),
                                          500);
      return;
    }

    if (e.type == 'mousedown' && e.button == this.mousePasteButton) {
      if (this.paste() === false) {
        console.warn('Could not paste manually due to web restrictions');
      }
    }

    if (e.type == 'mouseup' && e.button == 0 && this.copyOnSelect &&
        !this.document_.getSelection().isCollapsed) {
      this.copySelectionToClipboard();
    }

    if ((e.type == 'mousemove' || e.type == 'mouseup') &&
        this.scrollBlockerNode_.engaged) {
      // Disengage the scroll-blocker after one of these events.
      this.scrollBlockerNode_.engaged = false;
      this.scrollBlockerNode_.style.top = '-99px';
    }

    // Emulate arrow key presses via scroll wheel events.
    if (e.type == 'wheel') {
      const delta =
          this.scroll_port.scrollWheelDelta(/** @type {!WheelEvent} */ (e));

      // Helper to turn a wheel event delta into a series of key presses.
      const deltaToArrows = (distance, charSize, arrowPos, arrowNeg) => {
        if (distance == 0) {
          return '';
        }

        // Convert the scroll distance into a number of rows/cols.
        const cells = lib.f.smartFloorDivide(Math.abs(distance), charSize);
        const data = '\x1bO' + (distance < 0 ? arrowNeg : arrowPos);
        return data.repeat(cells);
      };

      // The order between up/down and left/right doesn't really matter.
      this.io.sendString(
          // Up/down arrow keys.
          deltaToArrows(delta.y, this.scroll_port.characterSize.height,
                        'A', 'B') +
          // Left/right arrow keys.
          deltaToArrows(delta.x, this.scroll_port.characterSize.width,
                        'C', 'D'),
      );

      e.preventDefault();
    }
  } else /* if (this.reportMouseEvents) */ {
    if (!this.scrollBlockerNode_.engaged) {
      if (e.type == 'mousedown') {
        // Move the scroll-blocker into place if we want to keep the scrollport
        // from scrolling.
        this.scrollBlockerNode_.engaged = true;
        this.scrollBlockerNode_.style.top = dpifud(e.clientY - 5);
        this.scrollBlockerNode_.style.left = dpifud(e.clientX - 5);
      } else if (e.type == 'mousemove') {
        // Oh.  This means that drag-scroll was disabled AFTER the mouse down,
        // in which case it's too late to engage the scroll-blocker.
        this.document_.getSelection().collapseToEnd();
        e.preventDefault();
      }
    }

    this.onMouse(e);
  }

  if (e.type == 'mouseup') {
    if (this.document_.getSelection().isCollapsed) {
      // Restore this on mouseup in case it was temporarily defeated with a
      // alt-mousedown.  Only do this when the selection is empty so that
      // we don't immediately kill the users selection.
      this.defeatMouseReports_ = false;
    }
  }
};

/**
 * Clients should override this if they care to know about mouse events.
 *
 * The event parameter will be a normal DOM mouse click event with additional
 * 'terminalRow' and 'terminalColumn' properties.
 *
 * @param {!MouseEvent} e The mouse event to handle.
 */
hterm.Terminal.prototype.onMouse = function(e) { };

/**
 * React when focus changes.
 *
 * @param {boolean} focused True if focused, false otherwise.
 */
hterm.Terminal.prototype.onFocusChange_ = function(focused) {
  this.termCursNode.setAttribute('focus', focused);
  this.restyleCursor_();

  if (this.reportFocus) {
    this.io.sendString(focused === true ? '\x1b[I' : '\x1b[O');
  }

  if (focused === true) {
    this.closeBellNotifications_();
  }
};

/**
 * React when the ScrollPort is scrolled.
 */
hterm.Terminal.prototype.onScroll_ = function() {
  this.scheduleSyncCursorPosition_();
};

/**
 * React when text is pasted into the scrollPort.
 *
 * @param {{text: string}} e The text of the paste event to handle.
 */
hterm.Terminal.prototype.onPaste_ = function(e) {
  this.onPasteData_(e.text);
};

/**
 * Handle pasted data.
 *
 * @param {string} data The pasted data.
 */
hterm.Terminal.prototype.onPasteData_ = function(data) {
  data = data.replace(/\n/mg, '\r');
  if (this.options_.bracketedPaste) {
    // We strip out most escape sequences as they can cause issues (like
    // inserting an \x1b[201~ midstream).  We pass through whitespace
    // though: 0x08:\b 0x09:\t 0x0a:\n 0x0d:\r.
    // This matches xterm behavior.
    // eslint-disable-next-line no-control-regex
    const filter = (data) => data.replace(/[\x00-\x07\x0b-\x0c\x0e-\x1f]/g, '');
    data = '\x1b[200~' + filter(data) + '\x1b[201~';
  }

  this.io.sendString(data);
};

/**
 * React when the user tries to copy from the scrollPort.
 *
 * @param {!Event} e The DOM copy event.
 */
hterm.Terminal.prototype.onCopy_ = function(e) {
  if (!this.useDefaultWindowCopy) {
    e.preventDefault();
    setTimeout(this.copySelectionToClipboard.bind(this), 0);
  }
};

/**
 * React when the ScrollPort is resized.
 *
 * Note: This function should not directly contain code that alters the internal
 * state of the terminal.  That kind of code belongs in realizeWidth or
 * realizeHeight, so that it can be executed synchronously in the case of a
 * programmatic width change.
 */
hterm.Terminal.prototype.onResize_ = function() {
  const screensz = this.scroll_port.getScreenSize();
  const columnCount = Math.floor(screensz.width /
                                 this.scroll_port.characterSize.width) || 0;
  const rowCount = lib.f.smartFloorDivide(
      screensz.height,
      this.scroll_port.characterSize.height) || 0;

  if (columnCount <= 0 || rowCount <= 0) {
    // We avoid these situations since they happen sometimes when the terminal
    // gets removed from the document or during the initial load, and we can't
    // deal with that.
    // This can also happen if called before the scrollPort calculates the
    // character size, meaning we dived by 0 above and default to 0 values.
    return;
  }

  const isNewSize = (columnCount != this.screenSize.width ||
                     rowCount != this.screenSize.height);

  // We do this even if the size didn't change, just to be sure everything is
  // in sync.
  this.realizeSize_(columnCount, rowCount);
  this.updateCssCharsize_();

  if (isNewSize) {
    this.overlaySize();
  }

  this.restyleCursor_();
  this.scheduleSyncCursorPosition_();

  this.scrollEnd();
};

/**
 * Set the scroll wheel move multiplier.  This will affect how fast the page
 * scrolls on wheel events.
 *
 * Defaults to 1.
 *
 * @param {number} multiplier The multiplier to set.
 */
hterm.Terminal.prototype.setScrollWheelMoveMultipler = function(multiplier) {
  this.scroll_port.setScrollWheelMoveMultipler(multiplier);
};

/**
 * Close all web notifications created by terminal bells.
 */
hterm.Terminal.prototype.closeBellNotifications_ = function() {
  this.bellNotificationList_.forEach(function(n) {
      n.close();
    });
  this.bellNotificationList_.length = 0;
};

/**
 * Syncs the cursor position when the scrollport gains focus.
 */
hterm.Terminal.prototype.onScrollportFocus_ = function() {
  // If the cursor is offscreen we set selection to the last row on the screen.
  const topRowIndex = this.scroll_port.getTopRowIndex();
  const bottomRowIndex = this.scroll_port.getBottomRowIndex(topRowIndex);
  const selection = this.document_.getSelection();
  if (!this.syncCursorPosition_() && selection) {
    selection.collapse(this.getRowNode(bottomRowIndex));
  }
};

/**
 * Clients can override this if they want to provide an options page.
 */
hterm.Terminal.prototype.onOpenOptionsPage = function() {};


/**
 * Called when user selects to open the options page.
 */
hterm.Terminal.prototype.onOpenOptionsPage_ = function() {
  this.onOpenOptionsPage();
};


/**
 * Client should override this if they want to handle tmux control mode DCS
 * sequence (see https://github.com/tmux/tmux/wiki/Control-Mode). We split the
 * sequence data into lines and call this once per line (the '\r\n' ending will
 * be stripped). When the sequence ends with ST, we call this once with null.
 *
 * @param {?string} line The line or null when the sequence ends.
 */
hterm.Terminal.prototype.onTmuxControlModeLine = function(line) {};
// SOURCE FILE: hterm/js/hterm_terminal_io.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Input/Output interface used by commands to communicate with the terminal.
 *
 * Commands like `nassh` and `crosh` receive an instance of this class as
 * part of their argv object.  This allows them to write to and read from the
 * terminal without exposing them to an entire hterm.Terminal instance.
 *
 * The active command must override the sendString() method
 * of this class in order to receive keystrokes and send output to the correct
 * destination.
 *
 * Isolating commands from the terminal provides the following benefits:
 * - Provides a mechanism to save and restore sendString
 *   handler when invoking subcommands (see the push() and pop() methods).
 * - The isolation makes it easier to make changes in Terminal and supporting
 *   classes without affecting commands.
 * - In The Future commands may run in web workers where they would only be able
 *   to talk to a Terminal instance through an IPC mechanism.
 *
 * @param {!hterm.Terminal} terminal
 * @constructor
 */
hterm.Terminal.IO = function(terminal) {
  this.terminal_ = terminal;

  // The IO object to restore on IO.pop().
  this.previousIO_ = null;

  // Any data this object accumulated while not active.
  this.buffered_ = '';

  // Decoder to maintain UTF-8 decode state.
  this.textDecoder_ = new TextDecoder();
};

/**
 * Show the terminal overlay.
 *
 * @see hterm.NotificationCenter.show
 * @param {string|!Node} message The message to display.
 * @param {?number=} timeout How long to time to wait before hiding.
 */
hterm.Terminal.IO.prototype.showOverlay = function(
    message, timeout = undefined) {
  this.terminal_.showOverlay(message, timeout);
};

/**
 * Hide the current overlay immediately.
 *
 * @see hterm.NotificationCenter.hide
 */
hterm.Terminal.IO.prototype.hideOverlay = function() {
  this.terminal_.hideOverlay();
};

/**
 * Create a new hterm.Terminal.IO instance and make it active on the Terminal
 * object associated with this instance.
 *
 * This is used to pass control of the terminal IO off to a subcommand.  The
 * IO.pop() method can be used to restore control when the subcommand completes.
 *
 * @return {!hterm.Terminal.IO} The new foreground IO instance.
 */
hterm.Terminal.IO.prototype.push = function() {
  const io = new this.constructor(this.terminal_);

  io.columnCount = this.columnCount;
  io.rowCount = this.rowCount;

  io.previousIO_ = this.terminal_.io;
  this.terminal_.io = io;

  return io;
};

/**
 * Restore the Terminal's previous IO object.
 *
 * We'll flush out any queued data.
 */
hterm.Terminal.IO.prototype.pop = function() {
  this.terminal_.io = this.previousIO_;
  this.previousIO_.flush();
};

/**
 * Flush accumulated data.
 *
 * If we're not the active IO, the connected process might still be writing
 * data to us, but we won't be displaying it.  Flush any buffered data now.
 */
hterm.Terminal.IO.prototype.flush = function() {
  if (this.buffered_) {
    this.terminal_.interpret(this.buffered_);
    this.buffered_ = '';
  }
};

/**
 * Called when data needs to be sent to the current command.
 *
 * Clients should override this to receive notification of pending data.
 *
 * @param {string} string The data to send.
 */
hterm.Terminal.IO.prototype.sendString = function(string) {
  // Override this.
  console.log('Unhandled sendString: ' + string);
};

/**
 * Receives notification when the terminal is resized.
 *
 * @param {number} width The new terminal width.
 * @param {number} height The new terminal height.
 */
hterm.Terminal.IO.prototype.onTerminalResize_ = function(width, height) {
  // eslint-disable-next-line consistent-this
  let obj = this;
  while (obj) {
    obj.columnCount = width;
    obj.rowCount = height;
    obj = obj.previousIO_;
  }

  this.onTerminalResize(width, height);
};

/**
 * Called when terminal size is changed.
 *
 * Clients should override this to receive notification of resize.
 *
 * @param {string|number} width The new terminal width.
 * @param {string|number} height The new terminal height.
 */
hterm.Terminal.IO.prototype.onTerminalResize = function(width, height) {
  // Override this.
};

/**
 * Write UTF-8 data to the terminal.
 *
 * @param {!ArrayBuffer|!Array<number>} buffer The UTF-8 data to print.
 */
hterm.Terminal.IO.prototype.writeUTF8 = function(buffer) {
  // Handle array buffers & typed arrays by normalizing into a typed array.
  const u8 = new Uint8Array(buffer);
  const string = this.textDecoder_.decode(u8, {stream: true});
  this.print(string);
};

/**
 * Write UTF-8 data to the terminal followed by CRLF.
 *
 * @param {!ArrayBuffer|!Array<number>} buffer The UTF-8 data to print.
 */
hterm.Terminal.IO.prototype.writelnUTF8 = function(buffer) {
  this.writeUTF8(buffer);
  // We need to use writeUTF8 to make sure we flush the decoder state.
  this.writeUTF8([0x0d, 0x0a]);
};

/**
 * Write a UTF-16 JavaScript string to the terminal.
 *
 * @param {string} string The string to print.
 */
hterm.Terminal.IO.prototype.print =
hterm.Terminal.IO.prototype.writeUTF16 = function(string) {
  // If another process has the foreground IO, buffer new data sent to this IO
  // (since it's in the background).  When we're made the foreground IO again,
  // we'll flush everything.
  if (this.terminal_.io != this) {
    this.buffered_ += string;
    return;
  }

  this.terminal_.interpret(string);
};

/**
 * Print a UTF-16 JavaScript string to the terminal followed by a newline.
 *
 * @param {string} string The string to print.
 */
hterm.Terminal.IO.prototype.println =
hterm.Terminal.IO.prototype.writelnUTF16 = function(string) {
  this.print(string + '\r\n');
};
// SOURCE FILE: hterm/js/hterm_text_attributes.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Constructor for TextAttribute objects.
 *
 * These objects manage a set of text attributes such as foreground/
 * background color, bold, faint, italic, blink, underline, and strikethrough.
 *
 * TextAttribute instances can be used to construct a DOM container implementing
 * the current attributes, or to test an existing DOM container for
 * compatibility with the current attributes.
 *
 * @constructor
 * @param {!Document=} document The parent document to use when creating
 *     new DOM containers.
 */
hterm.TextAttributes = function(document) {
  this.document_ = document;
  // These variables contain the source of the color as either:
  // SRC_DEFAULT  (use context default)
  // rgb(...)     (true color form)
  // number       (representing the index from color palette to use)
  /** @type {symbol|string|number} */
  this.foregroundSource = this.SRC_DEFAULT;
  /** @type {symbol|string|number} */
  this.backgroundSource = this.SRC_DEFAULT;
  /** @type {symbol|string|number} */
  this.underlineSource = this.SRC_DEFAULT;

  // These properties cache the value in the color table, but foregroundSource
  // and backgroundSource contain the canonical values.
  /** @type {symbol|string} */
  this.foreground = this.DEFAULT_COLOR;
  /** @type {symbol|string} */
  this.background = this.DEFAULT_COLOR;
  /** @type {symbol|string} */
  this.underlineColor = this.DEFAULT_COLOR;

  /** @const */
  this.defaultForeground = 'rgb(var(--hterm-foreground-color))';
  /** @const */
  this.defaultBackground = 'rgb(var(--hterm-background-color))';

  // Any attributes added here that do not default to falsey (e.g. undefined or
  // null) require a bit more care.  createContainer has to always attach the
  // attribute so matchesContainer can work correctly.
  this.bold = false;
  this.faint = false;
  this.italic = false;
  this.blink = false;
  this.underline = false;
  this.strikethrough = false;
  this.inverse = false;
  this.invisible = false;
  this.wcNode = false;
  this.asciiNode = true;
  /** @type {?string} */
  this.tileData = null;
  /** @type {?string} */
  this.uri = null;
  /** @type {?string} */
  this.uriId = null;

  /**
   * Colors set different to defaults in lib.colors.stockPalette.
   *
   * @type {!Array<string>}
   */
  this.colorPaletteOverrides = [];
};

/**
 * If true, use bright colors (if available) for bold text.
 */
hterm.TextAttributes.prototype.enableBoldAsBright = true;

/**
 * A sentinel constant meaning "whatever the default color is in this context".
 */
hterm.TextAttributes.prototype.DEFAULT_COLOR = Symbol('DEFAULT_COLOR');

/**
 * A constant string used to specify that source color is context default.
 */
hterm.TextAttributes.prototype.SRC_DEFAULT = Symbol('SRC_DEFAULT');

/**
 * The document object which should own the DOM nodes created by this instance.
 *
 * @param {!Document} document The parent document.
 */
hterm.TextAttributes.prototype.setDocument = function(document) {
  this.document_ = document;
};

/**
 * Create a deep copy of this object.
 *
 * @return {!hterm.TextAttributes} A deep copy of this object.
 */
hterm.TextAttributes.prototype.clone = function() {
  const rv = new hterm.TextAttributes();

  for (const key in this) {
    rv[key] = this[key];
  }

  rv.colorPaletteOverrides = this.colorPaletteOverrides.concat();
  return rv;
};

/**
 * Reset the current set of attributes.
 *
 * This does not affect the palette.  Use terminal.resetColorPalette() for
 * that.  It also doesn't affect the tile data, it's not meant to.
 */
hterm.TextAttributes.prototype.reset = function() {
  this.foregroundSource = this.SRC_DEFAULT;
  this.backgroundSource = this.SRC_DEFAULT;
  this.underlineSource = this.SRC_DEFAULT;
  this.foreground = this.DEFAULT_COLOR;
  this.background = this.DEFAULT_COLOR;
  this.underlineColor = this.DEFAULT_COLOR;
  this.bold = false;
  this.faint = false;
  this.italic = false;
  this.blink = false;
  this.underline = false;
  this.strikethrough = false;
  this.inverse = false;
  this.invisible = false;
  this.wcNode = false;
  this.asciiNode = true;
  this.uri = null;
  this.uriId = null;
};

/**
 * Test if the current attributes describe unstyled text.
 *
 * @return {boolean} True if the current attributes describe unstyled text.
 */
hterm.TextAttributes.prototype.isDefault = function() {
  return (this.foregroundSource == this.SRC_DEFAULT &&
          this.backgroundSource == this.SRC_DEFAULT &&
          !this.bold &&
          !this.faint &&
          !this.italic &&
          !this.blink &&
          !this.underline &&
          !this.strikethrough &&
          !this.inverse &&
          !this.invisible &&
          !this.wcNode &&
          this.asciiNode &&
          this.tileData == null &&
          this.uri == null);
};

/**
 * Create a DOM container (a span or a text node) with a style to match the
 * current set of attributes.
 *
 * This method will create a plain text node if the text is unstyled, or
 * an HTML span if the text is styled.  Due to lack of monospace wide character
 * fonts on certain systems (e.g. ChromeOS), we need to put each wide character
 * in a span of CSS class '.wc-node' which has double column width.
 * Each vt_tiledata tile is also represented by a span with a single
 * character, with CSS classes '.tile' and '.tile_<glyph number>'.
 *
 * @param {string=} textContent Optional text content for the new container.
 * @return {!Node} An HTML span or text nodes styled to match the current
 *     attributes.
 */
hterm.TextAttributes.prototype.createContainer = function(textContent = '') {
  if (this.isDefault()) {
    // Only attach attributes where we need an explicit default for the
    // matchContainer logic below.
    const node = this.document_.createTextNode(textContent);
    node.asciiNode = true;
    return node;
  }

  const span = this.document_.createElement('span');
  const style = span.style;
  const classes = [];

  if (this.foreground != this.DEFAULT_COLOR) {
    style.color = this.foreground.toString();
  }

  if (this.background != this.DEFAULT_COLOR) {
    style.backgroundColor = this.background.toString();
    // Make sure the span fills the line when changing the background color.
    // Otherwise, if the line happens to be taller than this glyph, we won't
    // fill the color completely leading to visual gaps.
    style.display = 'inline-block';
  }

  if (this.bold) style.fontWeight = 'var(--hterm-bold-weight)';

  if (this.faint) {
    span.faint = true;
  }

  if (this.italic) {
    style.fontStyle = 'italic';
  }

  if (this.blink) {
    classes.push('blink-node');
    span.blinkNode = true;
  }

  let textDecorationLine = '';
  span.underline = this.underline;
  if (this.underline) {
    textDecorationLine += ' underline';
    style.textDecorationStyle = this.underline;
  }
  if (this.underlineColor != this.DEFAULT_COLOR) {
    style.textDecorationColor = this.underlineColor;
  }
  if (this.strikethrough) {
    textDecorationLine += ' line-through';
    span.strikethrough = true;
  }
  if (textDecorationLine) {
    style.textDecorationLine = textDecorationLine;
  }

  if (this.wcNode) {
    classes.push('wc-node');
    span.wcNode = true;
  }
  span.asciiNode = this.asciiNode;

  if (this.tileData != null) {
    classes.push('tile');
    classes.push('tile_' + this.tileData);
    span.tileNode = true;
  }

  if (textContent) {
    span.textContent = textContent;
  }

  if (this.uri) {
    classes.push('uri-node');
    span.uriId = this.uriId;
    span.title = this.uri;
    span.addEventListener('click', hterm.openUrl.bind(this, this.uri));
  }

  if (classes.length) {
    span.className = classes.join(' ');
  }

  return span;
};

/**
 * Tests if the provided object (string, span or text node) has the same
 * style as this TextAttributes instance.
 *
 * This indicates that text with these attributes could be inserted directly
 * into the target DOM node.
 *
 * For the purposes of this method, a string is considered a text node.
 *
 * @param {string|!Node} obj The object to test.
 * @return {boolean} True if the provided container has the same style as
 *     this attributes instance.
 */
hterm.TextAttributes.prototype.matchesContainer = function(obj) {
  if (typeof obj == 'string' || obj.nodeType == Node.TEXT_NODE) {
    return this.isDefault();
  }

  const style = obj.style;

  // We don't want to put multiple characters in a wcNode or a tile.
  // See the comments in createContainer.
  // For attributes that default to false, we do not require that obj have them
  // declared, so always normalize them using !! (to turn undefined into false)
  // in the compares below.
  return (!(this.wcNode || obj.wcNode) &&
          this.asciiNode == obj.asciiNode &&
          !(this.tileData != null || obj.tileNode) &&
          this.uriId == obj.uriId &&
          (this.foreground == this.DEFAULT_COLOR &&
           style.color == '') &&
          (this.background == this.DEFAULT_COLOR &&
           style.backgroundColor == '') &&
          (this.underlineColor == this.DEFAULT_COLOR &&
           style.textDecorationColor == '') &&
          this.bold == !!style.fontWeight &&
          this.blink == !!obj.blinkNode &&
          this.italic == !!style.fontStyle &&
          this.underline == obj.underline &&
          !!this.strikethrough == !!obj.strikethrough);
};

/**
 * Updates foreground and background properties based on current indices and
 * other state.
 */
hterm.TextAttributes.prototype.syncColors = function() {
  function getBrightIndex(i) {
    if (i < 8) {
      // If the color is from the lower half of the ANSI 16, add 8.
      return i + 8;
    }

    // If it's not from the 16 color palette, ignore bold requests.  This
    // matches the behavior of gnome-terminal.
    return i;
  }

  // Expand the default color as makes sense.
  const getDefaultColor = (color, defaultColor) => {
    return color == this.DEFAULT_COLOR ? defaultColor : color;
  };

  // TODO(joelhockey): Remove redundant `typeof foo == 'number'` when
  // externs/es6.js is updated.
  // https://github.com/google/closure-compiler/pull/3472.

  if (this.enableBoldAsBright && this.bold) {
    if (typeof this.foregroundSource == 'number' &&
        Number.isInteger(this.foregroundSource)) {
      this.foregroundSource = getBrightIndex(this.foregroundSource);
    }
  }

  /**
   * @param {symbol|string|number} source
   * @return {symbol|string}
   */
  const colorFromSource = (source) => {
    if (source == this.SRC_DEFAULT) {
      return this.DEFAULT_COLOR;
    } else if (typeof source == 'number' && Number.isInteger(source)) {
      return `rgb(var(--hterm-color-${source}))`;
    } else {
      return source.toString();
    }
  };

  this.foreground = colorFromSource(this.foregroundSource);

  if (this.faint) {
    if (this.foreground == this.DEFAULT_COLOR) {
      this.foreground = 'rgba(var(--hterm-foreground-color), 0.67)';
    } else if (typeof this.foregroundSource == 'number' &&
        Number.isInteger(this.foregroundSource)) {
      this.foreground =
          `rgba(var(--hterm-color-${this.foregroundSource}), 0.67)`;
    } else {
      this.foreground = lib.colors.setAlpha(this.foreground.toString(), 0.67);
    }
  }

  this.background = colorFromSource(this.backgroundSource);

  // Once we've processed the bold-as-bright and faint attributes, swap.
  // This matches xterm/gnome-terminal.
  if (this.inverse) {
    const swp = getDefaultColor(this.foreground, this.defaultForeground);
    this.foreground = getDefaultColor(this.background, this.defaultBackground);
    this.background = swp;
  }

  // Process invisible settings last to keep it simple.
  if (this.invisible) {
    this.foreground = this.background;
  }

  this.underlineColor = colorFromSource(this.underlineSource);
};

/**
 * Static method used to test if the provided objects (strings, spans or
 * text nodes) have the same style.
 *
 * For the purposes of this method, a string is considered a text node.
 *
 * @param {string|!Node} obj1 An object to test.
 * @param {string|!Node} obj2 Another object to test.
 * @return {boolean} True if the containers have the same style.
 */
hterm.TextAttributes.containersMatch = function(obj1, obj2) {
  if (typeof obj1 == 'string') {
    return hterm.TextAttributes.containerIsDefault(obj2);
  }

  if (obj1.nodeType != obj2.nodeType) {
    return false;
  }

  if (obj1.nodeType == Node.TEXT_NODE) {
    return true;
  }

  const style1 = obj1.style;
  const style2 = obj2.style;

  return (style1.color == style2.color &&
          style1.backgroundColor == style2.backgroundColor &&
          style1.backgroundColor == style2.backgroundColor &&
          style1.fontWeight == style2.fontWeight &&
          style1.fontStyle == style2.fontStyle &&
          style1.textDecoration == style2.textDecoration &&
          style1.textDecorationColor == style2.textDecorationColor &&
          style1.textDecorationStyle == style2.textDecorationStyle &&
          style1.textDecorationLine == style2.textDecorationLine);
};

/**
 * Static method to test if a given DOM container represents unstyled text.
 *
 * For the purposes of this method, a string is considered a text node.
 *
 * @param {string|!Node} obj An object to test.
 * @return {boolean} True if the object is unstyled.
 */
hterm.TextAttributes.containerIsDefault = function(obj) {
  return typeof obj == 'string' || obj.nodeType == Node.TEXT_NODE;
};

/**
 * Static method to get the column width of a node's textContent.
 *
 * @param {!Node} node The HTML element to get the width of textContent
 *     from.
 * @return {number} The column width of the node's textContent.
 */
hterm.TextAttributes.nodeWidth = function(node) {
  if (!node.asciiNode) {
    return lib.wc.strWidth(node.textContent);
  } else {
    return node.textContent.length;
  }
};

/**
 * Static method to get the substr of a node's textContent.  The start index
 * and substr width are computed in column width.
 *
 * @param {!Node} node The HTML element to get the substr of textContent
 *     from.
 * @param {number} start The starting offset in column width.
 * @param {number=} width The width to capture in column width.
 * @return {string} The extracted substr of the node's textContent.
 */
hterm.TextAttributes.nodeSubstr = function(node, start, width) {
  if (!node.asciiNode) {
    return lib.wc.substr(node.textContent, start, width);
  } else {
    return node.textContent.substr(start, width);
  }
};

/**
 * Static method to split a string into contiguous runs of single-width
 * characters and runs of double-width characters.
 *
 * @param {string} str The string to split.
 * @return {!Array<{str:string, wcNode:boolean, asciiNode:boolean,
 *     wcStrWidth:number}>} An array of objects that contain substrings of str,
 *     where each substring is either a contiguous runs of single-width
 *     characters or a double-width character.  For objects that contain a
 *     double-width character, its wcNode property is set to true.  For objects
 *     that contain only ASCII content, its asciiNode property is set to true.
 */
hterm.TextAttributes.splitWidecharString = function(str) {
  const asciiRegex = new RegExp('^[\u0020-\u007f]*$');

  // Optimize for printable ASCII.  This should only take ~1ms/MB, but cuts out
  // 40ms+/MB when true.  If we're dealing with UTF8, then it's already slow.
  if (asciiRegex.test(str)) {
    return [{
      str: str,
      wcNode: false,
      asciiNode: true,
      wcStrWidth: str.length,
    }];
  }

  // Iterate over each grapheme and merge them together in runs of similar
  // strings.  We want to keep narrow and wide characters separate, and the
  // fewer overall segments we have, the faster we'll be as processing each
  // segment in the terminal print code is a bit slow.
  const segmenter = new Intl.Segmenter(undefined, {type: 'grapheme'});
  const it = segmenter.segment(str);

  const rv = [];
  for (const segment of it) {
    const grapheme = segment.segment;
    const isAscii = asciiRegex.test(grapheme);
    const strWidth = isAscii ? 1 : lib.wc.strWidth(grapheme);
    const isWideChar =
        isAscii ? false : (lib.wc.charWidth(grapheme.codePointAt(0)) == 2);

    // Only merge non-wide characters together.  Every wide character needs to
    // be separate so it can get a unique container.
    const prev = rv[rv.length - 1];
    if (prev && !isWideChar && !prev.wcNode) {
      prev.str += grapheme;
      prev.wcStrWidth += strWidth;
      prev.asciiNode = prev.asciiNode && isAscii;
    } else {
      rv.push({
        str: grapheme,
        wcNode: isWideChar,
        asciiNode: isAscii,
        wcStrWidth: strWidth,
      });
    }
  }

  return rv;
};
// SOURCE FILE: hterm/js/hterm_vt.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Constructor for the VT escape sequence interpreter.
 *
 * The interpreter operates on a terminal object capable of performing cursor
 * move operations, painting characters, etc.
 *
 * This interpreter is intended to be compatible with xterm, though it
 * ignores some of the more esoteric escape sequences.
 *
 * Control sequences are documented in hterm/docs/ControlSequences.md.
 *
 * @param {!hterm.Terminal} terminal Terminal to use with the interpreter.
 * @constructor
 */
hterm.VT = function(terminal) {
  /**
   * The display terminal object associated with this virtual terminal.
   */
  this.terminal = terminal;

  terminal.onMouse = this.onTerminalMouse_.bind(this);
  this.mouseReport = this.MOUSE_REPORT_DISABLED;
  this.mouseCoordinates = this.MOUSE_COORDINATES_X10;

  // We only want to report mouse moves between cells, not between pixels.
  this.lastMouseDragResponse_ = null;

  // Parse state left over from the last parse.  You should use the parseState
  // instance passed into your parse routine, rather than reading
  // this.parseState_ directly.
  this.parseState_ = new hterm.VT.ParseState(this.parseUnknown_);

  // Any "leading modifiers" for the escape sequence, such as '?', ' ', or the
  // other modifiers handled in this.parseCSI_.
  this.leadingModifier_ = '';

  // Any "trailing modifiers".  Same character set as a leading modifier,
  // except these are found after the numeric arguments.
  this.trailingModifier_ = '';

  // The amount of time we're willing to wait for the end of an OSC sequence.
  this.oscTimeLimit_ = 20000;

  /**
   * Whether to accept the 8-bit control characters.
   *
   * An 8-bit control character is one with the eighth bit set.  These
   * didn't work on 7-bit terminals so they all have two byte equivalents.
   * Most hosts still only use the two-byte versions.
   *
   * We ignore 8-bit control codes by default.  This is in order to avoid
   * issues with "accidental" usage of codes that need to be terminated.
   * The "accident" usually involves cat'ing binary data.
   */
  this.enable8BitControl = false;

  /**
   * Whether to allow the OSC 52 sequence to write to the system clipboard.
   */
  this.enableClipboardWrite = true;

  /**
   * The set of available character maps (used by G0...G3 below).
   */
  this.characterMaps = new hterm.VT.CharacterMaps();

  /**
   * The default G0...G3 character maps.
   * We default to the US/ASCII map everywhere as that aligns with other
   * terminals, and it makes it harder to accidentally switch to the graphics
   * character map (Ctrl+N).  Any program that wants to use the graphics map
   * will usually select it anyways since there's no guarantee what state any
   * of the maps are in at any particular time.
   */
  this.G0 = this.G1 = this.G2 = this.G3 =
      this.characterMaps.getMap('B');

  /**
   * The 7-bit visible character set.
   *
   * This is a mapping from inbound data to display glyph.  The GL set
   * contains the 94 bytes from 0x21 to 0x7e.
   *
   * The default GL set is 'B', US ASCII.
   */
  this.GL = 'G0';

  /**
   * The 8-bit visible character set.
   *
   * This is a mapping from inbound data to display glyph.  The GR set
   * contains the 94 bytes from 0xa1 to 0xfe.
   */
  this.GR = 'G0';

  /**
   * The current encoding of the terminal.
   *
   * We only support ECMA-35 and UTF-8, so go with a boolean here.
   * The encoding can be locked too.
   */
  this.codingSystemUtf8_ = false;
  this.codingSystemLocked_ = false;

  // Construct a regular expression to match the known one-byte control chars.
  // This is used in parseUnknown_ to quickly scan a string for the next
  // control character.
  this.cc1Pattern_ = null;
  this.updateEncodingState_();
};

/**
 * No mouse events.
 */
hterm.VT.prototype.MOUSE_REPORT_DISABLED = 0;

/**
 * DECSET mode 9.
 *
 * Report mouse down events only.
 */
hterm.VT.prototype.MOUSE_REPORT_PRESS = 1;

/**
 * DECSET mode 1000.
 *
 * Report mouse down/up events only.
 */
hterm.VT.prototype.MOUSE_REPORT_CLICK = 2;

/**
 * DECSET mode 1002.
 *
 * Report mouse down/up and movement while a button is down.
 */
hterm.VT.prototype.MOUSE_REPORT_DRAG = 3;

/**
 * DEC mode for X10 coorindates (the default).
 */
hterm.VT.prototype.MOUSE_COORDINATES_X10 = 0;

/**
 * DEC mode 1005 for UTF-8 coorindates.
 */
hterm.VT.prototype.MOUSE_COORDINATES_UTF8 = 1;

/**
 * DEC mode 1006 for SGR coorindates.
 */
hterm.VT.prototype.MOUSE_COORDINATES_SGR = 2;

/**
 * ParseState constructor.
 *
 * This object tracks the current state of the parse.  It has fields for the
 * current buffer, position in the buffer, and the parse function.
 *
 * @param {function(!hterm.VT.ParseState)=} defaultFunction The default parser
 *     function.
 * @param {?string=} buf Optional string to use as the current buffer.
 * @constructor
 */
hterm.VT.ParseState = function(defaultFunction, buf = null) {
  this.defaultFunction = defaultFunction;
  this.buf = buf;
  this.pos = 0;
  this.func = defaultFunction;
  this.args = [];
  // Whether any of the arguments in the args array have subarguments.
  // e.g. All CSI sequences are integer arguments separated by semi-colons,
  // so subarguments are further colon separated.
  this.subargs = null;
};

/**
 * Reset the parser function, buffer, and position.
 *
 * @param {string=} buf Optional string to use as the current buffer.
 */
hterm.VT.ParseState.prototype.reset = function(buf = '') {
  this.resetParseFunction();
  this.resetBuf(buf);
  this.resetArguments();
};

/**
 * Reset the parser function only.
 */
hterm.VT.ParseState.prototype.resetParseFunction = function() {
  this.func = this.defaultFunction;
};

/**
 * Reset the buffer and position only.
 *
 * @param {?string=} buf Optional new value for buf, defaults to null.
 */
hterm.VT.ParseState.prototype.resetBuf = function(buf = null) {
  this.buf = buf;
  this.pos = 0;
};

/**
 * Reset the arguments list only.
 *
 * Typically we reset arguments before parsing a sequence that uses them rather
 * than always trying to make sure they're in a good state.  This can lead to
 * confusion during debugging where args from a previous sequence appear to be
 * "sticking around" in other sequences (which in reality don't use args).
 *
 * @param {string=} arg_zero Optional initial value for args[0].
 */
hterm.VT.ParseState.prototype.resetArguments = function(arg_zero = undefined) {
  this.args.length = 0;
  if (arg_zero !== undefined) {
    this.args[0] = arg_zero;
  }
};

/**
 * Parse an argument as an integer.
 *
 * This assumes the inputs are already in the proper format.  e.g. This won't
 * handle non-numeric arguments.
 *
 * An "0" argument is treated the same as "" which means the default value will
 * be applied.  This is what most terminal sequences expect.
 *
 * @param {string} argstr The argument to parse directly.
 * @param {number=} defaultValue Default value if argstr is empty.
 * @return {number} The parsed value.
 */
hterm.VT.ParseState.prototype.parseInt = function(argstr, defaultValue) {
  if (defaultValue === undefined) {
    defaultValue = 0;
  }

  if (argstr) {
    const ret = parseInt(argstr, 10);
    // An argument of zero is treated as the default value.
    return ret == 0 ? defaultValue : ret;
  }
  return defaultValue;
};

/**
 * Get an argument as an integer.
 *
 * @param {number} argnum The argument number to retrieve.
 * @param {number=} defaultValue Default value if the argument is empty.
 * @return {number} The parsed value.
 */
hterm.VT.ParseState.prototype.iarg = function(argnum, defaultValue) {
  return this.parseInt(this.args[argnum], defaultValue);
};

/**
 * Check whether an argument has subarguments.
 *
 * @param {number} argnum The argument number to check.
 * @return {boolean} Whether the argument has subarguments.
 */
hterm.VT.ParseState.prototype.argHasSubargs = function(argnum) {
  return !!(this.subargs && this.subargs[argnum]);
};

/**
 * Mark an argument as having subarguments.
 *
 * @param {number} argnum The argument number that has subarguments.
 */
hterm.VT.ParseState.prototype.argSetSubargs = function(argnum) {
  if (this.subargs === null) {
    this.subargs = {};
  }
  this.subargs[argnum] = true;
};

/**
 * Advance the parse position.
 *
 * @param {number} count The number of bytes to advance.
 */
hterm.VT.ParseState.prototype.advance = function(count) {
  this.pos += count;
};

/**
 * Return the remaining portion of the buffer without affecting the parse
 * position.
 *
 * @return {string} The remaining portion of the buffer.
 */
hterm.VT.ParseState.prototype.peekRemainingBuf = function() {
  return this.buf.substr(this.pos);
};

/**
 * Return the next single character in the buffer without affecting the parse
 * position.
 *
 * @return {string} The next character in the buffer.
 */
hterm.VT.ParseState.prototype.peekChar = function() {
  return this.buf.substr(this.pos, 1);
};

/**
 * Return the next single character in the buffer and advance the parse
 * position one byte.
 *
 * @return {string} The next character in the buffer.
 */
hterm.VT.ParseState.prototype.consumeChar = function() {
  return this.buf.substr(this.pos++, 1);
};

/**
 * Return true if the buffer is empty, or the position is past the end.
 *
 * @return {boolean} Whether the buffer is empty, or the position is past the
 *     end.
 */
hterm.VT.ParseState.prototype.isComplete = function() {
  return this.buf == null || this.buf.length <= this.pos;
};

/**
 * Reset the parse state.
 */
hterm.VT.prototype.resetParseState = function() {
  this.parseState_.reset();
};

/**
 * Reset the VT back to baseline state.
 */
hterm.VT.prototype.reset = function() {
  this.G0 = this.G1 = this.G2 = this.G3 =
      this.characterMaps.getMap('B');

  this.GL = 'G0';
  this.GR = 'G0';

  this.mouseReport = this.MOUSE_REPORT_DISABLED;
  this.mouseCoordinates = this.MOUSE_COORDINATES_X10;
  this.lastMouseDragResponse_ = null;
};

/**
 * Handle terminal mouse events.
 *
 * See the "Mouse Tracking" section of [xterm].
 *
 * @param {!MouseEvent} e
 */
hterm.VT.prototype.onTerminalMouse_ = function(e) {
  // Short circuit a few events to avoid unnecessary processing.
  if (this.mouseReport == this.MOUSE_REPORT_DISABLED) {
    return;
  } else if (this.mouseReport != this.MOUSE_REPORT_DRAG &&
             e.type == 'mousemove') {
    return;
  }

  // Temporary storage for our response.
  let response;

  // Modifier key state.
  let mod = 0;
  if (this.mouseReport != this.MOUSE_REPORT_PRESS) {
    if (e.shiftKey) {
      mod |= 4;
    }
    if (e.metaKey) {
      mod |= 8;
    }
    if (e.ctrlKey) {
      mod |= 16;
    }
  }

  // X & Y coordinate reporting.
  let x;
  let y;
  // Normally X10 has a limit of 255, but since we only want to emit UTF-8 valid
  // streams, we limit ourselves to 127 to avoid setting the 8th bit.  If we do
  // re-enable this, we should re-enable the hterm_vt_tests.js too.
  let limit = 127;
  switch (this.mouseCoordinates) {
    case this.MOUSE_COORDINATES_UTF8:
      // UTF-8 mode is the same as X10 but with higher limits.
      limit = 2047;
    case this.MOUSE_COORDINATES_X10:
      // X10 reports coordinates by encoding into strings.
      x = String.fromCharCode(rangefit(e.terminalColumn + 32, 32, limit));
      y = String.fromCharCode(rangefit(e.terminalRow + 32, 32, limit));
      break;
    case this.MOUSE_COORDINATES_SGR:
      // SGR reports coordinates by transmitting the numbers directly.
      x = e.terminalColumn;
      y = e.terminalRow;
      break;
  }

  let b;
  switch (e.type) {
    case 'wheel':
      // Mouse wheel is treated as button 1 or 2 plus an additional 64.
      b = (((e.deltaY * -1) > 0) ? 0 : 1) + 64;
      b |= mod;
      if (this.mouseCoordinates == this.MOUSE_COORDINATES_SGR) {
        response = `\x1b[<${b};${x};${y}M`;
      } else {
        // X10 based modes (including UTF8) add 32 for legacy encoding reasons.
        response = '\x1b[M' + String.fromCharCode(b + 32) + x + y;
      }

      // Keep the terminal from scrolling.
      e.preventDefault();
      break;

    case 'mousedown':
      // Buttons are encoded as button number.
      b = Math.min(e.button, 2);
      // X10 based modes (including UTF8) add 32 for legacy encoding reasons.
      if (this.mouseCoordinates != this.MOUSE_COORDINATES_SGR) {
        b += 32;
      }

      // And mix in the modifier keys.
      b |= mod;

      if (this.mouseCoordinates == this.MOUSE_COORDINATES_SGR) {
        response = `\x1b[<${b};${x};${y}M`;
      } else {
        response = '\x1b[M' + String.fromCharCode(b) + x + y;
      }
      break;

    case 'mouseup':
      if (this.mouseReport != this.MOUSE_REPORT_PRESS) {
        if (this.mouseCoordinates == this.MOUSE_COORDINATES_SGR) {
          // SGR mode can report the released button.
          response = `\x1b[<${e.button};${x};${y}m`;
        } else {
          // X10 mode has no indication of which button was released.
          response = '\x1b[M\x23' + x + y;
        }
      }
      break;

    case 'mousemove':
      if (this.mouseReport == this.MOUSE_REPORT_DRAG && e.buttons) {
        // Standard button bits.  The XTerm protocol only reports the first
        // button press (e.g. if left & right are pressed, right is ignored),
        // and it only supports the first three buttons.  If none of them are
        // pressed, then XTerm flags it as a release.  We'll do the same.
        // X10 based modes (including UTF8) add 32 for legacy encoding reasons.
        b = this.mouseCoordinates == this.MOUSE_COORDINATES_SGR ? 0 : 32;

        // Priority here matches XTerm: left, middle, right.
        if (e.buttons & 0x1) {
          // Report left button.
          b += 0;
        } else if (e.buttons & 0x4) {
          // Report middle button.
          b += 1;
        } else if (e.buttons & 0x2) {
          // Report right button.
          b += 2;
        } else {
          // Release higher buttons.
          b += 3;
        }

        // Add 32 to indicate mouse motion.
        b += 32;

        // And mix in the modifier keys.
        b |= mod;

        if (this.mouseCoordinates == this.MOUSE_COORDINATES_SGR) {
          response = `\x1b[<${b};${x};${y}M`;
        } else {
          response = '\x1b[M' + String.fromCharCode(b) + x + y;
        }

        // If we were going to report the same cell because we moved pixels
        // within, suppress the report.  This is what xterm does and cuts
        // down on duplicate messages.
        if (this.lastMouseDragResponse_ == response) {
          response = '';
        } else {
          this.lastMouseDragResponse_ = response;
        }
      }

      break;

    case 'click':
    case 'dblclick':
      break;

    default:
      console.error('Unknown mouse event: ' + e.type, e);
      break;
  }

  if (response) {
    this.terminal.io.sendString(response);
  }
};

/**
 * Interpret a string of characters, displaying the results on the associated
 * terminal object.
 *
 * @param {string} buf The buffer to interpret.
 */
hterm.VT.prototype.interpret = function(buf) {
  this.parseState_.resetBuf(buf);

  while (!this.parseState_.isComplete()) {
    const func = this.parseState_.func;
    const pos = this.parseState_.pos;
    const buf = this.parseState_.buf;

    this.parseState_.func.call(this, this.parseState_);

    if (this.parseState_.func == func && this.parseState_.pos == pos &&
        this.parseState_.buf == buf) {
      throw new Error('Parser did not alter the state!');
    }
  }
};

/**
 * Set the encoding of the terminal.
 *
 * @param {string} encoding The name of the encoding to set.
 */
hterm.VT.prototype.setEncoding = function(encoding) {
  switch (encoding) {
    default:
      console.warn('Invalid value for "terminal-encoding": ' + encoding);
      // Fall through.
    case 'iso-2022':
      this.codingSystemUtf8_ = false;
      this.codingSystemLocked_ = false;
      break;
    case 'utf-8-locked':
      this.codingSystemUtf8_ = true;
      this.codingSystemLocked_ = true;
      break;
    case 'utf-8':
      this.codingSystemUtf8_ = true;
      this.codingSystemLocked_ = false;
      break;
  }

  this.updateEncodingState_();
};

/**
 * Refresh internal state when the encoding changes.
 */
hterm.VT.prototype.updateEncodingState_ = function() {
  // If we're in UTF8 mode, don't suport 8-bit escape sequences as we'll never
  // see those -- everything should be UTF8!
  const cc1 = Object.keys(hterm.VT.CC1)
      .filter((e) => !this.codingSystemUtf8_ || e.charCodeAt() < 0x80)
      .map((e) => '\\x' + lib.f.zpad(e.charCodeAt().toString(16), 2))
      .join('');
  this.cc1Pattern_ = new RegExp(`[${cc1}]`);
};

/**
 * The default parse function.
 *
 * This will scan the string for the first 1-byte control character (C0/C1
 * characters from [CTRL]).  Any plain text coming before the code will be
 * printed to the terminal, then the control character will be dispatched.
 *
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.prototype.parseUnknown_ = function(parseState) {
  const print = (str) => {
    if (!this.codingSystemUtf8_ && this[this.GL].GL) {
      str = this[this.GL].GL(str);
    }

    this.terminal.print(str);
  };

  // Search for the next contiguous block of plain text.
  const buf = parseState.peekRemainingBuf();
  const nextControl = buf.search(this.cc1Pattern_);

  if (nextControl == 0) {
    // We've stumbled right into a control character.
    this.dispatch('CC1', buf.substr(0, 1), parseState);
    parseState.advance(1);
    return;
  }

  if (nextControl == -1) {
    // There are no control characters in this string.
    print(buf);
    parseState.reset();
    return;
  }

  print(buf.substr(0, nextControl));
  this.dispatch('CC1', buf.substr(nextControl, 1), parseState);
  parseState.advance(nextControl + 1);
};

/**
 * Parse a Control Sequence Introducer code and dispatch it.
 *
 * See [CSI] for some useful information about these codes.
 *
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.prototype.parseCSI_ = function(parseState) {
  const ch = parseState.peekChar();
  const args = parseState.args;

  const finishParsing = () => {
    // Resetting the arguments isn't strictly necessary, but it makes debugging
    // less confusing (otherwise args will stick around until the next sequence
    // that needs arguments).
    parseState.resetArguments();
    // We need to clear subargs since we explicitly set it.
    parseState.subargs = null;
    parseState.resetParseFunction();
  };

  if (ch >= '@' && ch <= '~') {
    // This is the final character.
    this.dispatch('CSI', this.leadingModifier_ + this.trailingModifier_ + ch,
                  parseState);
    finishParsing();

  } else if (ch == ';') {
    // Parameter delimiter.
    if (this.trailingModifier_) {
      // Parameter delimiter after the trailing modifier.  That's a paddlin'.
      finishParsing();

    } else {
      if (!args.length) {
        // They omitted the first param, we need to supply it.
        args.push('');
      }

      args.push('');
    }

  } else if (ch >= '0' && ch <= '9' || ch == ':') {
    // Next byte in the current parameter.

    if (this.trailingModifier_) {
      // Numeric parameter after the trailing modifier.  That's a paddlin'.
      finishParsing();
    } else {
      if (!args.length) {
        args[0] = ch;
      } else {
        args[args.length - 1] += ch;
      }

      // Possible sub-parameters.
      if (ch == ':') {
        parseState.argSetSubargs(args.length - 1);
      }
    }

  } else if (ch >= ' ' && ch <= '?') {
    // Modifier character.
    if (!args.length) {
      this.leadingModifier_ += ch;
    } else {
      this.trailingModifier_ += ch;
    }

  } else if (this.cc1Pattern_.test(ch)) {
    // Control character.
    this.dispatch('CC1', ch, parseState);

  } else {
    // Unexpected character in sequence, bail out.
    finishParsing();
  }

  parseState.advance(1);
};

/**
 * Parse a Device Control String and dispatch it.
 *
 * See [DCS] for some useful information about these codes.
 *
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.prototype.parseDCS_ = function(parseState) {
  const ch = parseState.peekChar();
  const args = parseState.args;

  const finishParsing = () => {
    // Resetting the arguments isn't strictly necessary, but it makes debugging
    // less confusing (otherwise args will stick around until the next sequence
    // that needs arguments).
    parseState.resetArguments();
    parseState.resetParseFunction();
  };

  if (ch >= '@' && ch <= '~') {
    // This is the final character.
    parseState.advance(1);
    this.dispatch('DCS', this.leadingModifier_ + this.trailingModifier_ + ch,
                  parseState);

    // Don't reset the parser function if it's being handled.
    // The dispatched method must handle ST termination itself.
    if (parseState.func === this.parseDCS_) {
      parseState.func = this.parseUntilStringTerminator_;
    }
    return;

  } else if (ch === ';') {
    // Parameter delimiter.
    if (this.trailingModifier_) {
      // Parameter delimiter after the trailing modifier.  Abort parsing.
      finishParsing();

    } else {
      if (!args.length) {
        // They omitted the first param, we need to supply it.
        args.push('');
      }

      args.push('');
    }

  } else if (ch >= '0' && ch <= '9') {
    // Next byte in the current parameter.

    if (this.trailingModifier_) {
      // Numeric parameter after the trailing modifier.  Abort parsing.
      finishParsing();
    } else {
      if (!args.length) {
        args[0] = ch;
      } else {
        args[args.length - 1] += ch;
      }
    }

  } else if (ch >= ' ' && ch <= '?') {
    // Modifier character.
    if (!args.length) {
      this.leadingModifier_ += ch;
    } else {
      this.trailingModifier_ += ch;
    }

  } else if (this.cc1Pattern_.test(ch)) {
    // Control character.
    this.dispatch('CC1', ch, parseState);

  } else {
    // Unexpected character in sequence, bail out.
    finishParsing();
  }

  parseState.advance(1);
};


/**
 * Parse tmux control mode data, which is terminated with ST.
 *
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.prototype.parseTmuxControlModeData_ = function(parseState) {
  const args = parseState.args;
  if (!args.length) {
    // This stores the unfinished line.
    args[0] = '';
  }
  // Consume as many lines as possible.
  while (true) {
    const args0InitialLength = args[0].length;
    const buf = args[0] + parseState.peekRemainingBuf();
    args[0] = '';

    // Find either ST or line break.
    // eslint-disable-next-line no-control-regex
    const index = buf.search(/\x1b\\|\r\n/);
    if (index === -1) {
      parseState.args[0] = buf;
      parseState.resetBuf();
      return;
    }

    const data = buf.slice(0, index);
    parseState.advance(index + 2 - args0InitialLength);

    // Check if buf ends with ST.
    if (buf[index] === '\x1b') {
      if (data) {
        console.error(`unexpected data before ST: ${data}`);
      }
      this.terminal.onTmuxControlModeLine(null);
      parseState.resetArguments();
      parseState.resetParseFunction();
      return;
    }

    // buf ends with line break.
    this.terminal.onTmuxControlModeLine(data);
  }
};

/**
 * Skip over the string until the next String Terminator (ST, 'ESC \') or
 * Bell (BEL, '\x07').
 *
 * The string is accumulated in parseState.args[0].  Make sure to reset the
 * arguments (with parseState.resetArguments) before starting the parse.
 *
 * You can detect that parsing in complete by checking that the parse
 * function has changed back to the default parse function.
 *
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 * @return {boolean} If true, parsing is ongoing or complete.  If false, we've
 *     exceeded the max string sequence.
 */
hterm.VT.prototype.parseUntilStringTerminator_ = function(parseState) {
  let buf = parseState.peekRemainingBuf();
  const args = parseState.args;
  // Since we might modify parse state buffer locally, if we want to advance
  // the parse state buffer later on, we need to know how many chars we added.
  let bufInserted = 0;

  if (!args.length) {
    args[0] = '';
    args[1] = new Date().getTime();
  } else {
    // If our saved buffer ends with an escape, it's because we were hoping
    // it's an ST split across two buffers.  Move it from our saved buffer
    // to the start of our current buffer for processing anew.
    if (args[0].slice(-1) == '\x1b') {
      args[0] = args[0].slice(0, -1);
      buf = '\x1b' + buf;
      bufInserted = 1;
    }
  }

  // eslint-disable-next-line no-control-regex
  const nextTerminator = buf.search(/[\x1b\x07]/);
  const terminator = buf[nextTerminator];
  let foundTerminator;

  // If the next escape we see is not a start of a ST, fall through.  This will
  // either be invalid (embedded escape), or we'll queue it up (wait for \\).
  if (terminator == '\x1b' && buf[nextTerminator + 1] != '\\') {
    foundTerminator = false;
  } else {
    foundTerminator = (nextTerminator != -1);
  }

  if (!foundTerminator) {
    // No terminator here, have to wait for the next string.

    args[0] += buf;

    let abortReason;

    // Special case: If our buffering happens to split the ST (\e\\), we have to
    // buffer the content temporarily.  So don't reject a trailing escape here,
    // instead we let it timeout or be rejected in the next pass.
    if (terminator == '\x1b' && nextTerminator != buf.length - 1) {
      abortReason = 'embedded escape: ' + nextTerminator;
    }

    // We stuffed a Date into args[1] above.
    const elapsedTime = new Date().getTime() - args[1];
    if (elapsedTime > this.oscTimeLimit_) {
      abortReason = `timeout expired: ${elapsedTime}s`;
    }

    if (abortReason) {
      parseState.reset(args[0]);
      return false;
    }

    parseState.advance(buf.length - bufInserted);
    return true;
  }

  args[0] += buf.substr(0, nextTerminator);

  parseState.resetParseFunction();
  parseState.advance(nextTerminator +
                     (terminator == '\x1b' ? 2 : 1) - bufInserted);

  return true;
};

/**
 * Dispatch to the function that handles a given CC1, ESC, or CSI or VT52 code.
 *
 * @param {string} type
 * @param {string} code
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.prototype.dispatch = function(type, code, parseState) {
  const handler = hterm.VT[type][code];
  if (!handler) {
    return;
  }

  if (handler == hterm.VT.ignore) {
    return;
  }

  if (parseState.subargs && !handler.supportsSubargs) {
    return;
  }

  if (type == 'CC1' && code > '\x7f' && !this.enable8BitControl) {
    // It's kind of a hack to put this here, but...
    //
    // If we're dispatching a 'CC1' code, and it's got the eighth bit set,
    // but we're not supposed to handle 8-bit codes?  Just ignore it.
    //
    // This prevents an errant (DCS, '\x90'), (OSC, '\x9d'), (PM, '\x9e') or
    // (APC, '\x9f') from locking up the terminal waiting for its expected
    // (ST, '\x9c') or (BEL, '\x07').
    console.warn('Ignoring 8-bit control code: 0x' +
                 code.charCodeAt(0).toString(16));
    return;
  }

  handler.apply(this, [parseState, code]);
};

/**
 * Set one of the ANSI defined terminal mode bits.
 *
 * Invoked in response to SM/RM.
 *
 * Unexpected and unimplemented values are silently ignored.
 *
 * @param {string} code
 * @param {boolean} state
 */
hterm.VT.prototype.setANSIMode = function(code, state) {
  if (code == 4) {  // Insert Mode (IRM)
    this.terminal.setInsertMode(state);
  } else if (code == 20) {  // Automatic Newline (LNM)
    this.terminal.setAutoCarriageReturn(state);
  }
};

/**
 * Set or reset one of the DEC Private modes.
 *
 * Invoked in response to DECSET/DECRST.
 *
 * @param {string} code
 * @param {boolean} state
 */
hterm.VT.prototype.setDECMode = function(code, state) {
  var ignore;

  switch (parseInt(code, 10)) {
    case 3: ignore = 'DECCOLM (set terminal width)'; break;

    case 5:  // DECSCNM
      this.terminal.setReverseVideo(state);
      break;

    case 6:  // DECOM
      this.terminal.setOriginMode(state);
      break;

    case 7:  // DECAWM
      this.terminal.setWraparound(state);
      break;

    case 9:  // Report on mouse down events only (X10).
      this.mouseReport = (
          state ? this.MOUSE_REPORT_PRESS : this.MOUSE_REPORT_DISABLED);
      this.terminal.syncMouseStyle();
      break;

    case 12: ignore = '(att610) start blinking cursor'; break;

    case 25:  // DECTCEM
      this.terminal.setCursorVisible(state);
      break;

    case 30: ignore = 'scrollbar on/off (scroll not supported anyway)'; break;

    case 40: ignore = 'allow 80 - 132 (DECCOLM) Mode'; break;

    case 45:  // Reverse-wraparound Mode
      this.terminal.setReverseWraparound(state);
      break;

    case 1000:  // Report on mouse clicks only (X11).
      this.mouseReport = (
          state ? this.MOUSE_REPORT_CLICK : this.MOUSE_REPORT_DISABLED);
      this.terminal.syncMouseStyle();
      break;

    case 1002:  // Report on mouse clicks and drags
      this.mouseReport = (
          state ? this.MOUSE_REPORT_DRAG : this.MOUSE_REPORT_DISABLED);
      this.terminal.syncMouseStyle();
      break;

    case 1004:  // Report on window focus change.
      this.terminal.reportFocus = state;
      break;

    case 1005:  // Extended coordinates in UTF-8 mode.
      this.mouseCoordinates = (
          state ? this.MOUSE_COORDINATES_UTF8 : this.MOUSE_COORDINATES_X10);
      break;

    case 1006:  // Extended coordinates in SGR mode.
      this.mouseCoordinates = (
          state ? this.MOUSE_COORDINATES_SGR : this.MOUSE_COORDINATES_X10);
      break;

    case 1048:  // Save cursor as in DECSC.
      if (state) {
        this.terminal.saveCursorAndState();
      } else {
        this.terminal.restoreCursorAndState();
      }
      break;

    case 2004:  // Bracketed paste mode.
      this.terminal.setBracketedPaste(state);
      break;
  }

  if (ignore)
    console.log(`ignore DEC code ${code}, value ${state}, ${ignore}`);
};

/**
 * Function shared by control characters and escape sequences that are
 * ignored.
 */
hterm.VT.ignore = function() {};

/**
 * Collection of control characters expressed in a single byte.
 *
 * This includes the characters from the C0 and C1 sets (see [CTRL]) that we
 * care about.  Two byte versions of the C1 codes are defined in the
 * hterm.VT.ESC collection.
 *
 * The 'CC1' mnemonic here refers to the fact that these are one-byte Control
 * Codes.  It's only used in this source file and not defined in any of the
 * referenced documents.
 */
hterm.VT.CC1 = {};

/**
 * Collection of two-byte and three-byte sequences starting with ESC.
 */
hterm.VT.ESC = {};

/**
 * Collection of CSI (Control Sequence Introducer) sequences.
 *
 * These sequences begin with 'ESC [', and may take zero or more arguments.
 */
hterm.VT.CSI = {};

/**
 * Collection of DCS (Device Control String) sequences.
 *
 * These sequences begin with 'ESC P', may take zero or more arguments, and are
 * normally terminated by ST.  Registered handlers have to consume the ST if
 * they change the active parser func.
 */
hterm.VT.DCS = {};

/**
 * Collection of OSC (Operating System Control) sequences.
 *
 * These sequences begin with 'ESC ]', followed by a function number and a
 * string terminated by either ST or BEL.
 */
hterm.VT.OSC = {};

/**
 * Collection of VT52 sequences.
 *
 * When in VT52 mode, other sequences are disabled.
 */
hterm.VT.VT52 = {};

/**
 * Null (NUL).
 *
 * Silently ignored.
 */
hterm.VT.CC1['\x00'] = hterm.VT.ignore;

/**
 * Enquiry (ENQ).
 *
 * Transmit answerback message.
 *
 * The default answerback message in xterm is an empty string, so we just
 * ignore this.
 */
hterm.VT.CC1['\x05'] = hterm.VT.ignore;

/**
 * Ring Bell (BEL).
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x07'] = function() {
  this.terminal.ringBell();
};

/**
 * Backspace (BS).
 *
 * Move the cursor to the left one character position, unless it is at the
 * left margin, in which case no action occurs.
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x08'] = function() {
  this.terminal.cursorLeft(1);
};

/**
 * Horizontal Tab (HT).
 *
 * Move the cursor to the next tab stop, or to the right margin if no further
 * tab stops are present on the line.
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x09'] = function() {
  this.terminal.forwardTabStop();
};

/**
 * Line Feed (LF).
 *
 * This code causes a line feed or a new line operation.  See Automatic
 * Newline (LNM).
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x0a'] = function() {
  this.terminal.formFeed();
};

/**
 * Vertical Tab (VT).
 *
 * Interpreted as LF.
 */
hterm.VT.CC1['\x0b'] = hterm.VT.CC1['\x0a'];

/**
 * Form Feed (FF).
 *
 * Interpreted as LF.
 */
hterm.VT.CC1['\x0c'] = hterm.VT.CC1['\x0a'];

/**
 * Carriage Return (CR).
 *
 * Move cursor to the left margin on the current line.
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x0d'] = function() {
  this.terminal.setCursorColumn(0);
};

/**
 * Shift Out (SO), aka Lock Shift 0 (LS1).
 *
 * @this {!hterm.VT}
 * Invoke G1 character set in GL.
 */
hterm.VT.CC1['\x0e'] = function() {
  this.GL = 'G1';
};

/**
 * Shift In (SI), aka Lock Shift 0 (LS0).
 *
 * Invoke G0 character set in GL.
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x0f'] = function() {
  this.GL = 'G0';
};

/**
 * Transmit On (XON).
 *
 * Not currently implemented.
 *
 * TODO(rginda): Implement?
 */
hterm.VT.CC1['\x11'] = hterm.VT.ignore;

/**
 * Transmit Off (XOFF).
 *
 * Not currently implemented.
 *
 * TODO(rginda): Implement?
 */
hterm.VT.CC1['\x13'] = hterm.VT.ignore;

/**
 * Cancel (CAN).
 *
 * If sent during a control sequence, the sequence is immediately terminated
 * and not executed.
 *
 * It also causes the error character to be displayed.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x18'] = function(parseState) {
  // If we've shifted in the G1 character set, shift it back out to
  // the default character set.
  if (this.GL == 'G1') {
    this.GL = 'G0';
  }
  parseState.resetParseFunction();
  this.terminal.print('?');
};

/**
 * Substitute (SUB).
 *
 * Interpreted as CAN.
 */
hterm.VT.CC1['\x1a'] = hterm.VT.CC1['\x18'];

/**
 * Escape (ESC).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x1b'] = function(parseState) {
  function parseESC(parseState) {
    const ch = parseState.consumeChar();

    if (ch == '\x1b') {
      return;
    }

    this.dispatch('ESC', ch, parseState);

    if (parseState.func == parseESC) {
      parseState.resetParseFunction();
    }
  }

  parseState.func = parseESC;
};

/**
 * Delete (DEL).
 */
hterm.VT.CC1['\x7f'] = hterm.VT.ignore;

// 8 bit control characters and their two byte equivalents, below...

/**
 * Index (IND).
 *
 * Like newline, only keep the X position
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x84'] =
hterm.VT.ESC['D'] = function() {
  this.terminal.lineFeed();
};

/**
 * Next Line (NEL).
 *
 * Like newline, but doesn't add lines.
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x85'] =
hterm.VT.ESC['E'] = function() {
  this.terminal.setCursorColumn(0);
  this.terminal.cursorDown(1);
};

/**
 * Horizontal Tabulation Set (HTS).
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x88'] =
hterm.VT.ESC['H'] = function() {
  this.terminal.setTabStop(this.terminal.getCursorColumn());
};

/**
 * Reverse Index (RI).
 *
 * Move up one line.
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x8d'] =
hterm.VT.ESC['M'] = function() {
  this.terminal.reverseLineFeed();
};

/**
 * Single Shift 2 (SS2).
 *
 * Select of G2 Character Set for the next character only.
 *
 * Not currently implemented.
 */
hterm.VT.CC1['\x8e'] =
hterm.VT.ESC['N'] = hterm.VT.ignore;

/**
 * Single Shift 3 (SS3).
 *
 * Select of G3 Character Set for the next character only.
 *
 * Not currently implemented.
 */
hterm.VT.CC1['\x8f'] =
hterm.VT.ESC['O'] = hterm.VT.ignore;

/**
 * Device Control String (DCS).
 *
 * Indicate a DCS sequence.  See Device-Control functions in [XTERM].
 *
 * TODO(rginda): Consider implementing DECRQSS, the rest don't seem applicable.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x90'] =
hterm.VT.ESC['P'] = function(parseState) {
  parseState.resetArguments();
  this.leadingModifier_ = '';
  this.trailingModifier_ = '';
  parseState.func = this.parseDCS_;
};

/**
 * Start of Guarded Area (SPA).
 *
 * Will not implement.
 */
hterm.VT.CC1['\x96'] =
hterm.VT.ESC['V'] = hterm.VT.ignore;

/**
 * End of Guarded Area (EPA).
 *
 * Will not implement.
 */
hterm.VT.CC1['\x97'] =
hterm.VT.ESC['W'] = hterm.VT.ignore;

/**
 * Start of String (SOS).
 *
 * Will not implement.
 */
hterm.VT.CC1['\x98'] =
hterm.VT.ESC['X'] = hterm.VT.ignore;

/**
 * Single Character Introducer (SCI, also DECID).
 *
 * Return Terminal ID.  Obsolete form of 'ESC [ c' (DA).
 *
 * @this {!hterm.VT}
 */
hterm.VT.CC1['\x9a'] =
hterm.VT.ESC['Z'] = function() {
  this.terminal.io.sendString('\x1b[?1;2c');
};

/**
 * Control Sequence Introducer (CSI).
 *
 * The lead into most escape sequences.  See [CSI].
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x9b'] =
hterm.VT.ESC['['] = function(parseState) {
  parseState.resetArguments();
  this.leadingModifier_ = '';
  this.trailingModifier_ = '';
  parseState.func = this.parseCSI_;
};

/**
 * String Terminator (ST).
 *
 * Used to terminate DCS/OSC/PM/APC commands which may take string arguments.
 *
 * We don't directly handle it here, as it's only used to terminate other
 * sequences.  See the 'parseUntilStringTerminator_' method.
 */
hterm.VT.CC1['\x9c'] =
hterm.VT.ESC['\\'] = hterm.VT.ignore;

/**
 * Operating System Command (OSC).
 *
 * Commands relating to the operating system.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x9d'] =
hterm.VT.ESC[']'] = function(parseState) {
  parseState.resetArguments();

  /**
   * @param {!hterm.VT.ParseState} parseState The current parse state.
   */
  function parseOSC(parseState) {
    if (!this.parseUntilStringTerminator_(parseState)) {
      // The string sequence was too long.
      return;
    }

    if (parseState.func == parseOSC) {
      // We're not done parsing the string yet.
      return;
    }

    // We're done.
    const ary = parseState.args[0].match(/^(\d+);?(.*)$/);
    if (ary) {
      parseState.args[0] = ary[2];
      this.dispatch('OSC', ary[1], parseState);
    } else {
      console.warn('Invalid OSC: ' + JSON.stringify(parseState.args[0]));
    }

    // Resetting the arguments isn't strictly necessary, but it makes debugging
    // less confusing (otherwise args will stick around until the next sequence
    // that needs arguments).
    parseState.resetArguments();
  }

  parseState.func = parseOSC;
};

/**
 * Privacy Message (PM).
 *
 * Will not implement.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x9e'] =
hterm.VT.ESC['^'] = function(parseState) {
  parseState.resetArguments();
  parseState.func = this.parseUntilStringTerminator_;
};

/**
 * Application Program Control (APC).
 *
 * Will not implement.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CC1['\x9f'] =
hterm.VT.ESC['_'] = function(parseState) {
  parseState.resetArguments();
  parseState.func = this.parseUntilStringTerminator_;
};

/**
 * ESC \x20 - Unclear to me where these originated, possibly in xterm.
 *
 * Not currently implemented:
 *   ESC \x20 F - Select 7 bit escape codes in responses (S7C1T).
 *   ESC \x20 G - Select 8 bit escape codes in responses (S8C1T).
 *                NB: We currently assume S7C1T always.
 *
 * Will not implement:
 *   ESC \x20 L - Set ANSI conformance level 1.
 *   ESC \x20 M - Set ANSI conformance level 2.
 *   ESC \x20 N - Set ANSI conformance level 3.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.ESC['\x20'] = function(parseState) {
  parseState.func = function(parseState) {
    const ch = parseState.consumeChar();
    if (this.warnUnimplemented) {
      console.warn('Unimplemented sequence: ESC 0x20 ' + ch);
    }
    parseState.resetParseFunction();
  };
};

/**
 * DEC 'ESC #' sequences.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.ESC['#'] = function(parseState) {
  parseState.func = function(parseState) {
    const ch = parseState.consumeChar();
    if (ch == '8') {
      // DEC Screen Alignment Test (DECALN).
      this.terminal.setCursorPosition(0, 0);
      this.terminal.fill('E');
    }

    parseState.resetParseFunction();
  };
};

/**
 * Designate Other Coding System (DOCS).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.ESC['%'] = function(parseState) {
  parseState.func = function(parseState) {
    let ch = parseState.consumeChar();

    // If we've locked the encoding, then just eat the bytes and return.
    if (this.codingSystemLocked_) {
      if (ch == '/') {
        parseState.consumeChar();
      }
      parseState.resetParseFunction();
      return;
    }

    // Process the encoding requests.
    switch (ch) {
      case '@':
        // Switch to ECMA 35.
        this.setEncoding('iso-2022');
        break;

      case 'G':
        // Switch to UTF-8.
        this.setEncoding('utf-8');
        break;

      case '/':
        // One way transition to something else.
        ch = parseState.consumeChar();
        switch (ch) {
          case 'G':  // UTF-8 Level 1.
          case 'H':  // UTF-8 Level 2.
          case 'I':  // UTF-8 Level 3.
            // We treat all UTF-8 levels the same.
            this.setEncoding('utf-8-locked');
            break;

          default:
            if (this.warnUnimplemented) {
              console.warn('Unknown ESC % / argument: ' + JSON.stringify(ch));
            }
            break;
        }
        break;

      default:
        if (this.warnUnimplemented) {
          console.warn('Unknown ESC % argument: ' + JSON.stringify(ch));
        }
        break;
    }

    parseState.resetParseFunction();
  };
};

/**
 * Character Set Selection (SCS).
 *
 *   ESC ( Ps - Set G0 character set (VT100).
 *   ESC ) Ps - Set G1 character set (VT220).
 *   ESC * Ps - Set G2 character set (VT220).
 *   ESC + Ps - Set G3 character set (VT220).
 *   ESC - Ps - Set G1 character set (VT300).
 *   ESC . Ps - Set G2 character set (VT300).
 *   ESC / Ps - Set G3 character set (VT300).
 *
 * All other sequences are echoed to the terminal.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 * @param {string} code
 */
hterm.VT.ESC['('] =
hterm.VT.ESC[')'] =
hterm.VT.ESC['*'] =
hterm.VT.ESC['+'] =
hterm.VT.ESC['-'] =
hterm.VT.ESC['.'] =
hterm.VT.ESC['/'] = function(parseState, code) {
  parseState.func = function(parseState) {
    if (parseState.peekChar() === '\x1b') {
      // Invalid SCS sequence, treat this ESC as a new sequence starting.
      parseState.resetParseFunction();
      return;
    }
    const ch = parseState.consumeChar();
    const map = this.characterMaps.getMap(ch);
    if (map !== undefined) {
      if (code == '(') {
        this.G0 = map;
      } else if (code == ')' || code == '-') {
        this.G1 = map;
      } else if (code == '*' || code == '.') {
        this.G2 = map;
      } else if (code == '+' || code == '/') {
        this.G3 = map;
      }
    } else if (this.warnUnimplemented) {
      console.log('Invalid character set for "' + code + '": ' + ch);
    }

    parseState.resetParseFunction();
  };
};

/**
 * Back Index (DECBI).
 *
 * VT420 and up.  Not currently implemented.
 */
hterm.VT.ESC['6'] = hterm.VT.ignore;

/**
 * Save Cursor (DECSC).
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['7'] = function() {
  this.terminal.saveCursorAndState();
};

/**
 * Restore Cursor (DECRC).
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['8'] = function() {
  this.terminal.restoreCursorAndState();
};

/**
 * Forward Index (DECFI).
 *
 * VT210 and up.  Not currently implemented.
 */
hterm.VT.ESC['9'] = hterm.VT.ignore;

/**
 * Cursor to lower left corner of screen.
 *
 * Will not implement.
 *
 * This is only recognized by xterm when the hpLowerleftBugCompat resource is
 * set.
 */
hterm.VT.ESC['F'] = hterm.VT.ignore;

/**
 * Full Reset (RIS).
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['c'] = function() {
  this.terminal.reset();
};

/**
 * Set window name. This is used by tmux (maybe also screen) and it is different
 * from window title. See the "NAMES AND TITLES" section in `man tmux`.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.ESC['k'] = function(parseState) {
  function parse(parseState) {
    if (!this.parseUntilStringTerminator_(parseState)) {
      // The string sequence was too long.
      return;
    }

    if (parseState.func === parse) {
      // We're not done parsing the string yet.
      return;
    }

    this.terminal.setWindowName(parseState.args[0]);
    parseState.resetArguments();
  }

  parseState.resetArguments();
  parseState.func = parse;
};

/**
 * Memory lock/unlock.
 *
 * Will not implement.
 */
hterm.VT.ESC['l'] =
hterm.VT.ESC['m'] = hterm.VT.ignore;

/**
 * Lock Shift 2 (LS2)
 *
 * Invoke the G2 Character Set as GL.
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['n'] = function() {
  this.GL = 'G2';
};

/**
 * Lock Shift 3 (LS3)
 *
 * Invoke the G3 Character Set as GL.
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['o'] = function() {
  this.GL = 'G3';
};

/**
 * Lock Shift 2, Right (LS3R)
 *
 * Invoke the G3 Character Set as GR.
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['|'] = function() {
  this.GR = 'G3';
};

/**
 * Lock Shift 2, Right (LS2R)
 *
 * Invoke the G2 Character Set as GR.
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['}'] = function() {
  this.GR = 'G2';
};

/**
 * Lock Shift 1, Right (LS1R)
 *
 * Invoke the G1 Character Set as GR.
 *
 * @this {!hterm.VT}
 */
hterm.VT.ESC['~'] = function() {
  this.GR = 'G1';
};

/**
 * Tmux control mode if the args === ['1000'].
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.DCS['p'] = function(parseState) {
  if (parseState.args.length === 1 && parseState.args[0] === '1000') {
    parseState.resetArguments();
    parseState.func = this.parseTmuxControlModeData_;
  }
};

/**
 * Change icon name and window title.
 *
 * We only change the window title.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['0'] = function(parseState) {
  this.terminal.setWindowTitle(parseState.args[0]);
};

/**
 * Change window title.
 */
hterm.VT.OSC['2'] = hterm.VT.OSC['0'];

/**
 * Set/read color palette.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['4'] = function(parseState) {
  // Args come in as a single 'index1;rgb1 ... ;indexN;rgbN' string.
  // We split on the semicolon and iterate through the pairs.
  const args = parseState.args[0].split(';');

  const pairCount = Math.floor(args.length / 2);
  const responseArray = [];

  for (let pairNumber = 0; pairNumber < pairCount; ++pairNumber) {
    const colorIndex = parseInt(args[pairNumber * 2], 10);
    let colorValue = args[pairNumber * 2 + 1];

    if (colorIndex >= lib.colors.stockPalette.length) {
      continue;
    }

    if (colorValue == '?') {
      // '?' means we should report back the current color value.
      colorValue = lib.colors.rgbToX11(
          this.terminal.getColorPalette(colorIndex));
      if (colorValue) {
        responseArray.push(colorIndex + ';' + colorValue);
      }

      continue;
    }

    colorValue = lib.colors.x11ToCSS(colorValue);
    if (colorValue) {
      this.terminal.setColorPalette(colorIndex, colorValue);
    }
  }

  if (responseArray.length) {
    this.terminal.io.sendString('\x1b]4;' + responseArray.join(';') + '\x07');
  }
};

/**
 * Hyperlinks.
 *
 * The first argument is optional and colon separated:
 *   id=<id>
 * The second argument is the link itself.
 *
 * Calling with a non-blank URI starts it.  A blank URI stops it.
 *
 * https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['8'] = function(parseState) {
  const args = parseState.args[0].split(';');
  let id = null;
  let uri = null;

  if (args.length != 2 || args[1].length == 0) {
    // Reset link.
  } else {
    // Pull out any colon separated parameters in the first argument.
    const params = args[0].split(':');
    id = '';
    params.forEach((param) => {
      const idx = param.indexOf('=');
      if (idx == -1) {
        return;
      }

      const key = param.slice(0, idx);
      const value = param.slice(idx + 1);
      switch (key) {
        case 'id':
          id = value;
          break;
        default:
          // Ignore unknown keys.
          break;
      }
    });

    // The URI is in the second argument.
    uri = args[1];
  }

  const attrs = this.terminal.getTextAttributes();
  attrs.uri = uri;
  attrs.uriId = id;
};

/**
 * iTerm2 growl notifications.
 *
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['9'] = function(parseState) {
  // This just dumps the entire string as the message.
  hterm.notify({'body': parseState.args[0]});
};

/**
 * Change VT100 text foreground color.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['10'] = function(parseState) {
  // Args come in as a single string, but extra args will chain to the following
  // OSC sequences.
  const args = parseState.args[0].split(';');
  if (!args) {
    return;
  }

  const colorX11 = lib.colors.x11ToCSS(args.shift());
  if (colorX11) {
    this.terminal.setForegroundColor(colorX11);
  }

  if (args.length > 0) {
    parseState.args[0] = args.join(';');
    hterm.VT.OSC['11'].apply(this, [parseState]);
  }
};

/**
 * Change VT100 text background color.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['11'] = function(parseState) {
  // Args come in as a single string, but extra args will chain to the following
  // OSC sequences.
  const args = parseState.args[0].split(';');
  if (!args) {
    return;
  }

  const colorX11 = lib.colors.x11ToCSS(args.shift());
  if (colorX11) {
    this.terminal.setBackgroundColor(colorX11);
  }

  if (args.length > 0) {
    parseState.args[0] = args.join(';');
    hterm.VT.OSC['12'].apply(this, [parseState]);
  }
};

/**
 * Change text cursor color.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['12'] = function(parseState) {
  // Args come in as a single string, but extra args will chain to the following
  // OSC sequences.
  const args = parseState.args[0].split(';');
  if (!args) {
    return;
  }

  const colorX11 = lib.colors.x11ToCSS(args.shift());
  if (colorX11) {
    this.terminal.setCursorColor(colorX11);
  }

  /* Note: If we support OSC 13+, we'd chain it here.
  if (args.length > 0) {
    parseState.args[0] = args.join(';');
    hterm.VT.OSC['13'].apply(this, [parseState]);
  }
  */
};

/**
 * Set the cursor shape.
 *
 * Parameter is expected to be in the form "CursorShape=number", where number is
 * one of:
 *
 *   0 - Block
 *   1 - I-Beam
 *   2 - Underline
 *
 * This is a bit of a de-facto standard supported by iTerm 2 and Konsole.  See
 * also: DECSCUSR.
 *
 * Invalid numbers will restore the cursor to the block shape.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['50'] = function(parseState) {
  const args = parseState.args[0].match(/CursorShape=(.)/i);
  if (!args) {
    console.warn('Could not parse OSC 50 args: ' + parseState.args[0]);
    return;
  }

  switch (args[1]) {
    case '0': this.terminal.setCursorShape('b'); break;
    case '1': this.terminal.setCursorShape('|'); break;
    case '2': this.terminal.setCursorShape('_'); break;

    default: console.warn('invalid cursor shape: ', args[1]);
  }
};

/**
 * Set/read system clipboard.
 *
 * Read is not implemented due to security considerations.  A remote app
 * that is able to both write and read to the clipboard could essentially
 * take over your session.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['52'] = function(parseState) {
  if (!this.enableClipboardWrite) {
    return;
  }

  // Args come in as a single 'clipboard;b64-data' string.  The clipboard
  // parameter is used to select which of the X clipboards to address.  Since
  // we're not integrating with X, we treat them all the same.
  const args = parseState.args[0].match(/^[cps01234567]*;(.*)/);
  if (!args) {
    return;
  }

  let data;
  try {
    data = window.atob(args[1]);
  } catch (e) {
    // If the user sent us invalid base64 content, silently ignore it.
    return;
  }
  const decoder = new TextDecoder();
  const bytes = lib.codec.stringToCodeUnitArray(data);
  data = decoder.decode(bytes);
  if (data) {
    this.terminal.copyStringToClipboard(data);
  }
};

/**
 * Reset color palette.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['104'] = function(parseState) {
  // If there are no args, we reset the entire palette.
  if (!parseState.args[0]) {
    this.terminal.resetColorPalette();
    return;
  }

  // Args come in as a single 'index1;index2;...;indexN' string.
  // Split on the semicolon and iterate through the colors.
  const args = parseState.args[0].split(';');
  args.forEach((c) => this.terminal.resetColor(c));
};

/**
 * Reset foreground color.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['110'] = function(parseState) {
  this.terminal.setForegroundColor();
};

/**
 * Reset background color.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['111'] = function(parseState) {
  this.terminal.setBackgroundColor();
};

/**
 * Reset text cursor color.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['112'] = function(parseState) {
  this.terminal.setCursorColor();
};

/**
 * iTerm2 extended sequences.
 *
 * We only support image display atm.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['1337'] = function(parseState) {
  // Args come in as a set of key value pairs followed by data.
  // File=name=<base64>;size=123;inline=1:<base64 data>
  const args = parseState.args[0].match(/^File=([^:]*):([\s\S]*)$/m);
  if (!args) {
    if (this.warnUnimplemented) {
      console.log(`iTerm2 1337: unsupported sequence: ${args[1]}`);
    }
    return;
  }

  const options = {
    name: '',
    size: 0,
    preserveAspectRatio: true,
    inline: false,
    width: 'auto',
    height: 'auto',
    align: 'left',
    type: '',
    buffer: lib.codec.stringToCodeUnitArray(atob(args[2])).buffer,
  };
  // Walk the "key=value;" sets.
  args[1].split(';').forEach((ele) => {
    const kv = ele.match(/^([^=]+)=(.*)$/m);
    if (!kv) {
      return;
    }

    // Sanitize values nicely.
    switch (kv[1]) {
      case 'name':
        try {
          options.name = window.atob(kv[2]);
        } catch (e) {
          // Ignore invalid base64 from user.
        }
        break;
      case 'size':
        try {
          options.size = parseInt(kv[2], 10);
        } catch (e) {
          // Ignore invalid numbers from user.
        }
        break;
      case 'width':
        options.width = kv[2];
        break;
      case 'height':
        options.height = kv[2];
        break;
      case 'preserveAspectRatio':
        options.preserveAspectRatio = !(kv[2] == '0');
        break;
      case 'inline':
        options.inline = !(kv[2] == '0');
        break;
      // hterm-specific keys.
      case 'align':
        options.align = kv[2];
        break;
      case 'type':
        options.type = kv[2];
        break;
      default:
        // Ignore unknown keys.  Don't want remote stuffing our JS env.
        break;
    }
  });

  // This is a bit of a hack.  If the buffer has data following the image, we
  // need to delay processing of it until after we've finished with the image.
  // Otherwise while we wait for the the image to load asynchronously, the new
  // text data will intermingle with the image.
  if (options.inline) {
    const io = this.terminal.io;
    const queued = parseState.peekRemainingBuf();
    parseState.advance(queued.length);
    this.terminal.displayImage(options);
    io.print(queued);
  } else {
    this.terminal.displayImage(options);
  }
};

/**
 * URxvt perl modules.
 *
 * This is the escape system used by rxvt-unicode and its perl modules.
 * Obviously we don't support perl or custom modules, so we list a few common
 * ones that we find useful.
 *
 * Technically there is no format here, but most modules obey:
 * <module name>;<module args, usually ; delimited>
 *
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.OSC['777'] = function(parseState) {
  let ary;
  const urxvtMod = parseState.args[0].split(';', 1)[0];

  switch (urxvtMod) {
    case 'notify': {
      // Format:
      // notify;title;message
      let title;
      let message;
      ary = parseState.args[0].match(/^[^;]+;([^;]*)(;([\s\S]*))?$/);
      if (ary) {
        title = ary[1];
        message = ary[3];
      }
      hterm.notify({'title': title, 'body': message});
      break;
    }

    default:
      console.warn('Unknown urxvt module: ' + parseState.args[0]);
      break;
  }
};

/**
 * Insert (blank) characters (ICH).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['@'] = function(parseState) {
  this.terminal.insertSpace(parseState.iarg(0, 1));
};

/**
 * Cursor Up (CUU).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['A'] = function(parseState) {
  this.terminal.cursorUp(parseState.iarg(0, 1));
};

/**
 * Cursor Down (CUD).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['B'] = function(parseState) {
  this.terminal.cursorDown(parseState.iarg(0, 1));
};

/**
 * Cursor Forward (CUF).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['C'] = function(parseState) {
  this.terminal.cursorRight(parseState.iarg(0, 1));
};

/**
 * Cursor Backward (CUB).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['D'] = function(parseState) {
  this.terminal.cursorLeft(parseState.iarg(0, 1));
};

/**
 * Cursor Next Line (CNL).
 *
 * This is like Cursor Down, except the cursor moves to the beginning of the
 * line as well.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['E'] = function(parseState) {
  this.terminal.cursorDown(parseState.iarg(0, 1));
  this.terminal.setCursorColumn(0);
};

/**
 * Cursor Preceding Line (CPL).
 *
 * This is like Cursor Up, except the cursor moves to the beginning of the
 * line as well.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['F'] = function(parseState) {
  this.terminal.cursorUp(parseState.iarg(0, 1));
  this.terminal.setCursorColumn(0);
};

/**
 * Cursor Horizontal Absolute (CHA).
 *
 * Xterm calls this Cursor Character Absolute.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['G'] = function(parseState) {
  this.terminal.setCursorColumn(parseState.iarg(0, 1) - 1);
};

/**
 * Cursor Position (CUP).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['H'] = function(parseState) {
  this.terminal.setCursorPosition(parseState.iarg(0, 1) - 1,
                                  parseState.iarg(1, 1) - 1);
};

/**
 * Cursor Forward Tabulation (CHT).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['I'] = function(parseState) {
  let count = parseState.iarg(0, 1);
  count = rangefit(count, 1, this.terminal.screenSize.width);
  for (let i = 0; i < count; i++) {
    this.terminal.forwardTabStop();
  }
};

/**
 * Erase in Display (ED, DECSED).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['J'] =
hterm.VT.CSI['?J'] = function(parseState) {
  const arg = parseState.args[0];

  if (!arg || arg == 0) {
    this.terminal.eraseBelow();
  } else if (arg == 1) {
    this.terminal.eraseAbove();
  } else if (arg == 2) {
    this.terminal.clear();
  } else if (arg == 3) {
    // clear scrollback, but we don't have that feature
  }
};

/**
 * Erase in line (EL, DECSEL).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['K'] =
hterm.VT.CSI['?K'] = function(parseState) {
  const arg = parseState.args[0];

  if (!arg || arg == 0) {
    this.terminal.eraseToRight();
  } else if (arg == 1) {
    this.terminal.eraseToLeft();
  } else if (arg == 2) {
    this.terminal.eraseLine();
  }
};

/**
 * Insert Lines (IL).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['L'] = function(parseState) {
  this.terminal.insertLines(parseState.iarg(0, 1));
};

/**
 * Delete Lines (DL).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['M'] = function(parseState) {
  this.terminal.deleteLines(parseState.iarg(0, 1));
};

/**
 * Delete Characters (DCH).
 *
 * This command shifts the line contents left, starting at the cursor position.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['P'] = function(parseState) {
  this.terminal.deleteChars(parseState.iarg(0, 1));
};

/**
 * Scroll Up (SU).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['S'] = function(parseState) {
  this.terminal.vtScrollUp(parseState.iarg(0, 1));
};

/**
 * Scroll Down (SD).
 * Also 'Initiate highlight mouse tracking'.  Will not implement this part.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['T'] = function(parseState) {
  if (parseState.args.length <= 1) {
    this.terminal.vtScrollDown(parseState.iarg(0, 1));
  }
};

/**
 * Reset one or more features of the title modes to the default value.
 *
 *   ESC [ > Ps T
 *
 * Normally, "reset" disables the feature. It is possible to disable the
 * ability to reset features by compiling a different default for the title
 * modes into xterm.
 *
 * Ps values:
 *   0 - Do not set window/icon labels using hexadecimal.
 *   1 - Do not query window/icon labels using hexadecimal.
 *   2 - Do not set window/icon labels using UTF-8.
 *   3 - Do not query window/icon labels using UTF-8.
 *
 * Will not implement.
 */
hterm.VT.CSI['>T'] = hterm.VT.ignore;

/**
 * Erase Characters (ECH).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['X'] = function(parseState) {
  this.terminal.eraseToRight(parseState.iarg(0, 1));
};

/**
 * Cursor Backward Tabulation (CBT).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['Z'] = function(parseState) {
  let count = parseState.iarg(0, 1);
  count = rangefit(count, 1, this.terminal.screenSize.width);
  for (let i = 0; i < count; i++) {
    this.terminal.backwardTabStop();
  }
};

/**
 * Character Position Absolute (HPA).
 *
 * Same as Cursor Horizontal Absolute (CHA).
 */
hterm.VT.CSI['`'] = hterm.VT.CSI['G'];

/**
 * Character Position Relative (HPR).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['a'] = function(parseState) {
  this.terminal.setCursorColumn(this.terminal.getCursorColumn() +
                                parseState.iarg(0, 1));
};

/**
 * Repeat the preceding graphic character.
 *
 * Not currently implemented.
 */
hterm.VT.CSI['b'] = hterm.VT.ignore;

/**
 * Send Device Attributes (Primary DA).
 *
 * TODO(rginda): This is hardcoded to send back 'VT100 with Advanced Video
 * Option', but it may be more correct to send a VT220 response once
 * we fill out the 'Not currently implemented' parts.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['c'] = function(parseState) {
  if (!parseState.args[0] || parseState.args[0] == 0) {
    this.terminal.io.sendString('\x1b[?1;2c');
  }
};

/**
 * Send Device Attributes (Secondary DA).
 *
 * TODO(rginda): This is hardcoded to send back 'VT100' but it may be more
 * correct to send a VT220 response once we fill out more 'Not currently
 * implemented' parts.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['>c'] = function(parseState) {
  this.terminal.io.sendString('\x1b[>0;256;0c');
};

/**
 * Line Position Absolute (VPA).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['d'] = function(parseState) {
  this.terminal.setAbsoluteCursorRow(parseState.iarg(0, 1) - 1);
};

/**
 * Horizontal and Vertical Position (HVP).
 *
 * Same as Cursor Position (CUP).
 */
hterm.VT.CSI['f'] = hterm.VT.CSI['H'];

/**
 * Tab Clear (TBC).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['g'] = function(parseState) {
  if (!parseState.args[0] || parseState.args[0] == 0) {
    // Clear tab stop at cursor.
    this.terminal.clearTabStopAtCursor();
  } else if (parseState.args[0] == 3) {
    // Clear all tab stops.
    this.terminal.clearAllTabStops();
  }
};

/**
 * Set Mode (SM).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['h'] = function(parseState) {
  for (let i = 0; i < parseState.args.length; i++) {
    this.setANSIMode(parseState.args[i], true);
  }
};

/**
 * DEC Private Mode Set (DECSET).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['?h'] = function(parseState) {
  for (let i = 0; i < parseState.args.length; i++) {
    this.setDECMode(parseState.args[i], true);
  }
};

/**
 * Media Copy (MC).
 * Media Copy (MC, DEC Specific).
 *
 * These commands control the printer.  Will not implement.
 */
hterm.VT.CSI['i'] =
hterm.VT.CSI['?i'] = hterm.VT.ignore;

/**
 * Reset Mode (RM).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['l'] = function(parseState) {
  for (let i = 0; i < parseState.args.length; i++) {
    this.setANSIMode(parseState.args[i], false);
  }
};

/**
 * DEC Private Mode Reset (DECRST).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current parse state.
 */
hterm.VT.CSI['?l'] = function(parseState) {
  for (let i = 0; i < parseState.args.length; i++) {
    this.setDECMode(parseState.args[i], false);
  }
};

/**
 * Parse extended SGR 38/48 sequences.
 *
 * This deals with the various ISO 8613-6 forms, and with legacy xterm forms
 * that are common in the wider application world.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState The current input state.
 * @param {number} i The argument in parseState to start processing.
 * @param {!hterm.TextAttributes} attrs The current text attributes.
 * @return {!Object} The skipCount member defines how many arguments to skip
 *     (i.e. how many were processed), and the color member is the color that
 *     was successfully processed, or undefined if not.
 */
hterm.VT.prototype.parseSgrExtendedColors = function(parseState, i, attrs) {
  let ary;
  let usedSubargs;

  if (parseState.argHasSubargs(i)) {
    // The ISO 8613-6 compliant form.
    // e.g. 38:[color choice]:[arg1]:[arg2]:...
    ary = parseState.args[i].split(':');
    ary.shift();  // Remove "38".
    usedSubargs = true;
  } else if (parseState.argHasSubargs(i + 1)) {
    // The xterm form which isn't ISO 8613-6 compliant.  Not many emulators
    // support this, and others actively do not want to.  We'll ignore it so
    // at least the rest of the stream works correctly.  e.g. 38;2:R:G:B
    // We return 0 here so we only skip the "38" ... we can't be confident the
    // next arg is actually supposed to be part of it vs a typo where the next
    // arg is legit.
    return {skipCount: 0};
  } else {
    // The xterm form which isn't ISO 8613-6 compliant, but many emulators
    // support, and many applications rely on.
    // e.g. 38;2;R;G;B
    ary = parseState.args.slice(i + 1);
    usedSubargs = false;
  }

  // Figure out which form to parse.
  switch (parseInt(ary[0], 10)) {
    default:  // Unknown.
    case 0:  // Implementation defined.  We ignore it.
      return {skipCount: 0};

    case 1: {  // Transparent color.
      // Require ISO 8613-6 form.
      if (!usedSubargs) {
        return {skipCount: 0};
      }

      return {
        color: 'rgba(0, 0, 0, 0)',
        skipCount: 0,
      };
    }

    case 2: {  // RGB color.
      // Skip over the color space identifier, if it exists.
      let start;
      if (usedSubargs) {
        // The ISO 8613-6 compliant form:
        //   38:2:<color space id>:R:G:B[:...]
        // The xterm form isn't ISO 8613-6 compliant.
        //   38:2:R:G:B
        // Since the ISO 8613-6 form requires at least 5 arguments,
        // we can still support the xterm form unambiguously.
        if (ary.length == 4) {
          start = 1;
        } else {
          start = 2;
        }
      } else {
        // The legacy xterm form: 38;2;R;G;B
        start = 1;
      }

      // We need at least 3 args for RGB.  If we don't have them, assume this
      // sequence is corrupted, so don't eat anything more.
      // We ignore more than 3 args on purpose since ISO 8613-6 defines some,
      // and we don't care about them.
      if (ary.length < start + 3) {
        return {skipCount: 0};
      }

      const r = parseState.parseInt(ary[start + 0]);
      const g = parseState.parseInt(ary[start + 1]);
      const b = parseState.parseInt(ary[start + 2]);
      return {
        color: `rgb(${r}, ${g}, ${b})`,
        skipCount: usedSubargs ? 0 : 4,
      };
    }

    case 3: {  // CMY color.
      // No need to support xterm/legacy forms as xterm doesn't support CMY.
      if (!usedSubargs) {
        return {skipCount: 0};
      }

      // We need at least 4 args for CMY.  If we don't have them, assume
      // this sequence is corrupted.  We ignore the color space identifier,
      // tolerance, etc...
      if (ary.length < 4) {
        return {skipCount: 0};
      }

      // TODO: See CMYK below.
      // const c = parseState.parseInt(ary[1]);
      // const m = parseState.parseInt(ary[2]);
      // const y = parseState.parseInt(ary[3]);
      return {skipCount: 0};
    }

    case 4: {  // CMYK color.
      // No need to support xterm/legacy forms as xterm doesn't support CMYK.
      if (!usedSubargs) {
        return {skipCount: 0};
      }

      // We need at least 5 args for CMYK.  If we don't have them, assume
      // this sequence is corrupted.  We ignore the color space identifier,
      // tolerance, etc...
      if (ary.length < 5) {
        return {skipCount: 0};
      }

      // TODO: Implement this.
      // Might wait until CSS4 is adopted for device-cmyk():
      // https://www.w3.org/TR/css-color-4/#cmyk-colors
      // Or normalize it to RGB ourselves:
      // https://www.w3.org/TR/css-color-4/#cmyk-rgb
      // const c = parseState.parseInt(ary[1]);
      // const m = parseState.parseInt(ary[2]);
      // const y = parseState.parseInt(ary[3]);
      // const k = parseState.parseInt(ary[4]);
      return {skipCount: 0};
    }

    case 5: {  // Color palette index.
      // If we're short on args, assume this sequence is corrupted, so don't
      // eat anything more.
      if (ary.length < 2) {
        return {skipCount: 0};
      }

      // Support 38:5:P (ISO 8613-6) and 38;5;P (xterm/legacy).
      // We also ignore extra args with 38:5:P:[...], but more for laziness.
      const ret = {
        skipCount: usedSubargs ? 0 : 2,
      };
      const color = parseState.parseInt(ary[1]);
      if (color < lib.colors.stockPalette.length) {
        ret.color = color;
      }
      return ret;
    }
  }
};

/**
 * Character Attributes (SGR).
 *
 * Iterate through the list of arguments, applying the attribute changes based
 * on the argument value...
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.CSI['m'] = function(parseState) {
  const attrs = this.terminal.getTextAttributes();

  if (!parseState.args.length) {
    attrs.reset();
    return;
  }

  for (let i = 0; i < parseState.args.length; i++) {
    // If this argument has subargs (i.e. it has args followed by colons),
    // the iarg logic will implicitly truncate that off for us.
    const arg = parseState.iarg(i, 0);

    if (arg < 30) {
      if (arg == 0) {  // Normal (default).
        attrs.reset();
      } else if (arg == 1) {  // Bold.
        attrs.bold = true;
      } else if (arg == 2) {  // Faint.
        attrs.faint = true;
      } else if (arg == 3) {  // Italic.
        attrs.italic = true;
      } else if (arg == 4) {  // Underline.
        if (parseState.argHasSubargs(i)) {
          const uarg = parseState.args[i].split(':')[1];
          if (uarg == 0) {
            attrs.underline = false;
          } else if (uarg == 1) {
            attrs.underline = 'solid';
          } else if (uarg == 2) {
            attrs.underline = 'double';
          } else if (uarg == 3) {
            attrs.underline = 'wavy';
          } else if (uarg == 4) {
            attrs.underline = 'dotted';
          } else if (uarg == 5) {
            attrs.underline = 'dashed';
          }
        } else {
          attrs.underline = 'solid';
        }
      } else if (arg == 5) {  // Blink.
        attrs.blink = true;
      } else if (arg == 7) {  // Inverse.
        attrs.inverse = true;
      } else if (arg == 8) {  // Invisible.
        attrs.invisible = true;
      } else if (arg == 9) {  // Crossed out.
        attrs.strikethrough = true;
      } else if (arg == 21) {  // Double underlined.
        attrs.underline = 'double';
      } else if (arg == 22) {  // Not bold & not faint.
        attrs.bold = false;
        attrs.faint = false;
      } else if (arg == 23) {  // Not italic.
        attrs.italic = false;
      } else if (arg == 24) {  // Not underlined.
        attrs.underline = false;
      } else if (arg == 25) {  // Not blink.
        attrs.blink = false;
      } else if (arg == 27) {  // Steady.
        attrs.inverse = false;
      } else if (arg == 28) {  // Visible.
        attrs.invisible = false;
      } else if (arg == 29) {  // Not crossed out.
        attrs.strikethrough = false;
      }

    } else if (arg < 50) {
      // Select fore/background color from bottom half of 16 color palette
      // or from the 256 color palette or alternative specify color in fully
      // qualified rgb(r, g, b) form.
      if (arg < 38) {
        attrs.foregroundSource = arg - 30;

      } else if (arg == 38) {
        const result = this.parseSgrExtendedColors(parseState, i, attrs);
        if (result.color !== undefined) {
          attrs.foregroundSource = result.color;
        }
        i += result.skipCount;

      } else if (arg == 39) {
        attrs.foregroundSource = attrs.SRC_DEFAULT;

      } else if (arg < 48) {
        attrs.backgroundSource = arg - 40;

      } else if (arg == 48) {
        const result = this.parseSgrExtendedColors(parseState, i, attrs);
        if (result.color !== undefined) {
          attrs.backgroundSource = result.color;
        }
        i += result.skipCount;

      } else {
        attrs.backgroundSource = attrs.SRC_DEFAULT;
      }

    } else if (arg == 58) {  // Underline coloring.
      const result = this.parseSgrExtendedColors(parseState, i, attrs);
      if (result.color !== undefined) {
        attrs.underlineSource = result.color;
      }
      i += result.skipCount;

    } else if (arg == 59) {  // Disable underline coloring.
      attrs.underlineSource = attrs.SRC_DEFAULT;

    } else if (arg >= 90 && arg <= 97) {
      attrs.foregroundSource = arg - 90 + 8;

    } else if (arg >= 100 && arg <= 107) {
      attrs.backgroundSource = arg - 100 + 8;
    }
  }

  attrs.syncColors();
};

// SGR calls can handle subargs.
hterm.VT.CSI['m'].supportsSubargs = true;

/**
 * Set xterm-specific keyboard modes.
 *
 * Will not implement.
 */
hterm.VT.CSI['>m'] = hterm.VT.ignore;

/**
 * Device Status Report (DSR, DEC Specific).
 *
 * 5 - Status Report. Result (OK) is CSI 0 n
 * 6 - Report Cursor Position (CPR) [row;column]. Result is CSI r ; c R
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.CSI['n'] = function(parseState) {
  if (parseState.args[0] == 5) {
    this.terminal.io.sendString('\x1b0n');
  } else if (parseState.args[0] == 6) {
    const row = this.terminal.getCursorRow() + 1;
    const col = this.terminal.getCursorColumn() + 1;
    this.terminal.io.sendString('\x1b[' + row + ';' + col + 'R');
  }
};

/**
 * Disable modifiers which may be enabled via CSI['>m'].
 *
 * Will not implement.
 */
hterm.VT.CSI['>n'] = hterm.VT.ignore;

/**
 * Device Status Report (DSR, DEC Specific).
 *
 * 6  - Report Cursor Position (CPR) [row;column] as CSI ? r ; c R
 * 15 - Report Printer status as CSI ? 1 0 n (ready) or
 *      CSI ? 1 1 n (not ready).
 * 25 - Report UDK status as CSI ? 2 0 n (unlocked) or CSI ? 2 1 n (locked).
 * 26 - Report Keyboard status as CSI ? 2 7 ; 1 ; 0 ; 0 n (North American).
 *      The last two parameters apply to VT400 & up, and denote keyboard ready
 *      and LK01 respectively.
 * 53 - Report Locator status as CSI ? 5 3 n Locator available, if compiled-in,
 *      or CSI ? 5 0 n No Locator, if not.
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.CSI['?n'] = function(parseState) {
  if (parseState.args[0] == 6) {
    const row = this.terminal.getCursorRow() + 1;
    const col = this.terminal.getCursorColumn() + 1;
    this.terminal.io.sendString('\x1b[' + row + ';' + col + 'R');
  } else if (parseState.args[0] == 15) {
    this.terminal.io.sendString('\x1b[?11n');
  } else if (parseState.args[0] == 25) {
    this.terminal.io.sendString('\x1b[?21n');
  } else if (parseState.args[0] == 26) {
    this.terminal.io.sendString('\x1b[?12;1;0;0n');
  } else if (parseState.args[0] == 53) {
    this.terminal.io.sendString('\x1b[?50n');
  }
};

/**
 * This is used by xterm to decide whether to hide the pointer cursor as the
 * user types.
 *
 * Valid values for the parameter:
 *   0 - Never hide the pointer.
 *   1 - Hide if the mouse tracking mode is not enabled.
 *   2 - Always hide the pointer.
 *
 * If no parameter is given, xterm uses the default, which is 1.
 *
 * Not currently implemented.
 */
hterm.VT.CSI['>p'] = hterm.VT.ignore;

/**
 * Soft terminal reset (DECSTR).
 *
 * @this {!hterm.VT}
 */
hterm.VT.CSI['!p'] = function() {
  this.terminal.softReset();
};

/**
 * Request ANSI Mode (DECRQM).
 *
 * Not currently implemented.
 */
hterm.VT.CSI['$p'] = hterm.VT.ignore;
hterm.VT.CSI['?$p'] = hterm.VT.ignore;

/**
 * Set conformance level (DECSCL).
 *
 * Not currently implemented.
 */
hterm.VT.CSI['"p'] = hterm.VT.ignore;

/**
 * Load LEDs (DECLL).
 *
 * Not currently implemented.  Could be implemented as virtual LEDs overlaying
 * the terminal if anyone cares.
 */
hterm.VT.CSI['q'] = hterm.VT.ignore;

/**
 * Set cursor style (DECSCUSR, VT520).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.CSI[' q'] = function(parseState) {
  const arg = parseState.args[0];

  if (arg == 0 || arg == 1) {
    this.terminal.setCursorShape('b');
    this.terminal.setCursorBlink('y');
  } else if (arg == 2) {
    this.terminal.setCursorShape('b');
    this.terminal.setCursorBlink('n');
  } else if (arg == 3) {
    this.terminal.setCursorShape('_');
    this.terminal.setCursorBlink('y');
  } else if (arg == 4) {
    this.terminal.setCursorShape('_');
    this.terminal.setCursorBlink('n');
  } else if (arg == 5) {
    this.terminal.setCursorShape('|');
    this.terminal.setCursorBlink('y');
  } else if (arg == 6) {
    this.terminal.setCursorShape('|');
    this.terminal.setCursorBlink('n');
  } else {
    console.warn('Unknown cursor style: ' + arg);
  }
};

/**
 * Select character protection attribute (DECSCA).
 *
 * Will not implement.
 */
hterm.VT.CSI['"q'] = hterm.VT.ignore;

/**
 * Set Scrolling Region (DECSTBM).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.CSI['r'] = function(parseState) {
  const args = parseState.args;
  const top = args[0] ? parseInt(args[0], 10) : 0;
  const bottom =
      args[1] ? parseInt(args[1], 10) : this.terminal.screenSize.height;
  // Silently ignore bad args.
  if (top < 0 || bottom > this.terminal.screenSize.height || bottom <= top) {
    return;
  }
  // Convert from 1-based to 0-based with special case for zero.
  this.terminal.setVTScrollRegion(top === 0 ? null : top - 1, bottom - 1);
  this.terminal.setCursorPosition(0, 0);
};

/**
 * Restore DEC Private Mode Values.
 *
 * Will not implement.
 */
hterm.VT.CSI['?r'] = hterm.VT.ignore;

/**
 * Change Attributes in Rectangular Area (DECCARA)
 *
 * Will not implement.
 */
hterm.VT.CSI['$r'] = hterm.VT.ignore;

/**
 * Save cursor (ANSI.SYS)
 *
 * @this {!hterm.VT}
 */
hterm.VT.CSI['s'] = function() {
  this.terminal.saveCursorAndState();
};

/**
 * Save DEC Private Mode Values.
 *
 * Will not implement.
 */
hterm.VT.CSI['?s'] = hterm.VT.ignore;

/**
 * Window manipulation (from dtterm, as well as extensions).
 *
 * Will not implement.
 */
hterm.VT.CSI['t'] = hterm.VT.ignore;

/**
 * Reverse Attributes in Rectangular Area (DECRARA).
 *
 * Will not implement.
 */
hterm.VT.CSI['$t'] = hterm.VT.ignore;

/**
 * Set one or more features of the title modes.
 *
 * Will not implement.
 */
hterm.VT.CSI['>t'] = hterm.VT.ignore;

/**
 * Set warning-bell volume (DECSWBV, VT520).
 *
 * Will not implement.
 */
hterm.VT.CSI[' t'] = hterm.VT.ignore;

/**
 * Restore cursor (ANSI.SYS).
 *
 * @this {!hterm.VT}
 */
hterm.VT.CSI['u'] = function() {
  this.terminal.restoreCursorAndState();
};

/**
 * Set margin-bell volume (DECSMBV, VT520).
 *
 * Will not implement.
 */
hterm.VT.CSI[' u'] = hterm.VT.ignore;

/**
 * Copy Rectangular Area (DECCRA, VT400 and up).
 *
 * Will not implement.
 */
hterm.VT.CSI['$v'] = hterm.VT.ignore;

/**
 * Enable Filter Rectangle (DECEFR).
 *
 * Will not implement.
 */
hterm.VT.CSI['\'w'] = hterm.VT.ignore;

/**
 * Request Terminal Parameters (DECREQTPARM).
 *
 * Not currently implemented.
 */
hterm.VT.CSI['x'] = hterm.VT.ignore;

/**
 * Select Attribute Change Extent (DECSACE).
 *
 * Will not implement.
 */
hterm.VT.CSI['*x'] = hterm.VT.ignore;

/**
 * Fill Rectangular Area (DECFRA), VT420 and up.
 *
 * Will not implement.
 */
hterm.VT.CSI['$x'] = hterm.VT.ignore;

/**
 * vt_tiledata (as used by NAOhack and UnNetHack)
 * (see https://nethackwiki.com/wiki/Vt_tiledata for more info)
 *
 * Implemented as far as we care (start a glyph and end a glyph).
 *
 * @this {!hterm.VT}
 * @param {!hterm.VT.ParseState} parseState
 */
hterm.VT.CSI['z'] = function(parseState) {
  if (parseState.args.length < 1) {
    return;
  }
  const arg = parseState.args[0];
  if (arg == 0) {
    // Start a glyph (one parameter, the glyph number).
    if (parseState.args.length < 2) {
      return;
    }
    this.terminal.getTextAttributes().tileData = parseState.args[1];
  } else if (arg == 1) {
    // End a glyph.
    this.terminal.getTextAttributes().tileData = null;
  }
};

/**
 * Enable Locator Reporting (DECELR).
 *
 * Not currently implemented.
 */
hterm.VT.CSI['\'z'] = hterm.VT.ignore;

/**
 * Erase Rectangular Area (DECERA), VT400 and up.
 *
 * Will not implement.
 */
hterm.VT.CSI['$z'] = hterm.VT.ignore;

/**
 * Select Locator Events (DECSLE).
 *
 * Not currently implemented.
 */
hterm.VT.CSI['\'{'] = hterm.VT.ignore;

/**
 * Request Locator Position (DECRQLP).
 *
 * Not currently implemented.
 */
hterm.VT.CSI['\'|'] = hterm.VT.ignore;

/**
 * Insert Columns (DECIC), VT420 and up.
 *
 * Will not implement.
 */
hterm.VT.CSI['\'}'] = hterm.VT.ignore;

/**
 * Delete P s Columns (DECDC), VT420 and up.
 *
 * Will not implement.
 */
hterm.VT.CSI['\'~'] = hterm.VT.ignore;
// SOURCE FILE: hterm/js/hterm_vt_character_map.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Character map object.
 *
 * Mapping from received to display character, used depending on the active
 * VT character set.
 *
 * GR maps are not currently supported.
 *
 * @param {string} description A human readable description of this map.
 * @param {?Object} glmap The GL mapping from input to output characters.
 * @constructor
 */
hterm.VT.CharacterMap = function(description, glmap) {
  /**
   * Short description for this character set, useful for debugging.
   */
  this.description = description;

  /**
   * The function to call to when this map is installed in GL.
   */
  this.GL = null;

  // Always keep an unmodified reference to the map.
  // This allows us to easily reset back to the original state.
  this.glmapBase_ = glmap;

  // Now sync the internal state as needed.
  this.sync_();
};

/**
 * Internal helper for resyncing internal state.
 *
 * Used when the mappings change.
 *
 * @param {!Object=} glmap Additional mappings to overlay on top of the
 *     base mapping.
 */
hterm.VT.CharacterMap.prototype.sync_ = function(glmap = undefined) {
  // If there are no maps, then reset the state back.
  if (!this.glmapBase_ && !glmap) {
    this.GL = null;
    delete this.glmap_;
    delete this.glre_;
    return;
  }

  // Set the the GL mapping.  If we're given a custom mapping, then create a
  // new object to hold the merged map.  This way we can cleanly reset back.
  if (glmap) {
    this.glmap_ = Object.assign({}, this.glmapBase_, glmap);
  } else {
    this.glmap_ = this.glmapBase_;
  }

  const glchars = Object.keys(lib.notNull(this.glmap_)).map(
      (key) => '\\x' + lib.f.zpad(key.charCodeAt(0).toString(16), 2));
  this.glre_ = new RegExp('[' + glchars.join('') + ']', 'g');

  this.GL = (str) => str.replace(this.glre_, (ch) => this.glmap_[ch]);
};

/**
 * Reset map back to original mappings (discarding runtime updates).
 *
 * Specifically, any calls to setOverrides will be discarded.
 */
hterm.VT.CharacterMap.prototype.reset = function() {
  // If we haven't been given a custom mapping, then there's nothing to reset.
  if (this.glmap_ !== this.glmapBase_) {
    this.sync_();
  }
};

/**
 * Merge custom changes to this map.
 *
 * The input map need not duplicate the existing mappings as it is merged with
 * the existing base map (what was created with).  Subsequent calls to this
 * will throw away previous override settings.
 *
 * @param {!Object} glmap The custom map to override existing mappings.
 */
hterm.VT.CharacterMap.prototype.setOverrides = function(glmap) {
  this.sync_(glmap);
};

/**
 * Return a copy of this mapping.
 *
 * @return {!hterm.VT.CharacterMap} A new hterm.VT.CharacterMap instance.
 */
hterm.VT.CharacterMap.prototype.clone = function() {
  const map = new hterm.VT.CharacterMap(this.description, this.glmapBase_);
  if (this.glmap_ !== this.glmapBase_) {
    map.setOverrides(this.glmap_);
  }
  return map;
};

/**
 * Table of character maps.
 *
 * @constructor
 */
hterm.VT.CharacterMaps = function() {
  this.maps_ = hterm.VT.CharacterMaps.DefaultMaps;

  // Always keep an unmodified reference to the map.
  // This allows us to easily reset back to the original state.
  this.mapsBase_ = this.maps_;
};

/**
 * Look up a previously registered map.
 *
 * @param {string} name The name of the map to lookup.
 * @return {!hterm.VT.CharacterMap|undefined} The map, if it's been registered
 *     or undefined.
 */
hterm.VT.CharacterMaps.prototype.getMap = function(name) {
  if (this.maps_.hasOwnProperty(name)) {
    return this.maps_[name];
  } else {
    return undefined;
  }
};

/**
 * Register a new map.
 *
 * Any previously registered maps by this name will be discarded.
 *
 * @param {string} name The name of the map.
 * @param {!hterm.VT.CharacterMap} map The map to register.
 */
hterm.VT.CharacterMaps.prototype.addMap = function(name, map) {
  if (this.maps_ === this.mapsBase_) {
    this.maps_ = Object.assign({}, this.mapsBase_);
  }
  this.maps_[name] = map;
};

/**
 * Reset the table and all its maps back to original state.
 */
hterm.VT.CharacterMaps.prototype.reset = function() {
  if (this.maps_ !== hterm.VT.CharacterMaps.DefaultMaps) {
    this.maps_ = hterm.VT.CharacterMaps.DefaultMaps;
  }
};

/**
 * Merge custom changes to this table.
 *
 * @param {!Object} maps A set of hterm.VT.CharacterMap objects.
 */
hterm.VT.CharacterMaps.prototype.setOverrides = function(maps) {
  if (this.maps_ === this.mapsBase_) {
    this.maps_ = Object.assign({}, this.mapsBase_);
  }

  for (const name in maps) {
    const map = this.getMap(name);
    if (map !== undefined) {
      this.maps_[name] = map.clone();
      this.maps_[name].setOverrides(maps[name]);
    } else {
      this.addMap(name, new hterm.VT.CharacterMap('user ' + name, maps[name]));
    }
  }
};

/**
 * The default set of supported character maps.
 */
hterm.VT.CharacterMaps.DefaultMaps = {};

/**
 * VT100 Graphic character map.
 * http://vt100.net/docs/vt220-rm/table2-4.html
 */
hterm.VT.CharacterMaps.DefaultMaps['0'] = new hterm.VT.CharacterMap(
    'graphic', {
      '\x60':'\u25c6',  // ` -> diamond
      '\x61':'\u2592',  // a -> grey-box
      '\x62':'\u2409',  // b -> h/t
      '\x63':'\u240c',  // c -> f/f
      '\x64':'\u240d',  // d -> c/r
      '\x65':'\u240a',  // e -> l/f
      '\x66':'\u00b0',  // f -> degree
      '\x67':'\u00b1',  // g -> +/-
      '\x68':'\u2424',  // h -> n/l
      '\x69':'\u240b',  // i -> v/t
      '\x6a':'\u2518',  // j -> bottom-right
      '\x6b':'\u2510',  // k -> top-right
      '\x6c':'\u250c',  // l -> top-left
      '\x6d':'\u2514',  // m -> bottom-left
      '\x6e':'\u253c',  // n -> line-cross
      '\x6f':'\u23ba',  // o -> scan1
      '\x70':'\u23bb',  // p -> scan3
      '\x71':'\u2500',  // q -> scan5
      '\x72':'\u23bc',  // r -> scan7
      '\x73':'\u23bd',  // s -> scan9
      '\x74':'\u251c',  // t -> left-tee
      '\x75':'\u2524',  // u -> right-tee
      '\x76':'\u2534',  // v -> bottom-tee
      '\x77':'\u252c',  // w -> top-tee
      '\x78':'\u2502',  // x -> vertical-line
      '\x79':'\u2264',  // y -> less-equal
      '\x7a':'\u2265',  // z -> greater-equal
      '\x7b':'\u03c0',  // { -> pi
      '\x7c':'\u2260',  // | -> not-equal
      '\x7d':'\u00a3',  // } -> british-pound
      '\x7e':'\u00b7',  // ~ -> dot
    });

/**
 * British character map.
 * http://vt100.net/docs/vt220-rm/table2-5.html
 */
hterm.VT.CharacterMaps.DefaultMaps['A'] = new hterm.VT.CharacterMap(
    'british', {
      '\x23': '\u00a3',  // # -> british-pound
    });

/**
 * US ASCII map, no changes.
 */
hterm.VT.CharacterMaps.DefaultMaps['B'] = new hterm.VT.CharacterMap(
    'us', null);

/**
 * Dutch character map.
 * http://vt100.net/docs/vt220-rm/table2-6.html
 */
hterm.VT.CharacterMaps.DefaultMaps['4'] = new hterm.VT.CharacterMap(
    'dutch', {
      '\x23': '\u00a3',  // # -> british-pound

      '\x40': '\u00be',  // @ -> 3/4

      '\x5b': '\u0132',  // [ -> 'ij' ligature (xterm goes with \u00ff?)
      '\x5c': '\u00bd',  // \ -> 1/2
      '\x5d': '\u007c',  // ] -> vertical bar

      '\x7b': '\u00a8',  // { -> two dots
      '\x7c': '\u0066',  // | -> f
      '\x7d': '\u00bc',  // } -> 1/4
      '\x7e': '\u00b4',  // ~ -> acute
    });

/**
 * Finnish character map.
 * http://vt100.net/docs/vt220-rm/table2-7.html
 */
hterm.VT.CharacterMaps.DefaultMaps['C'] =
hterm.VT.CharacterMaps.DefaultMaps['5'] = new hterm.VT.CharacterMap(
    'finnish', {
      '\x5b': '\u00c4',  // [ -> 'A' umlaut
      '\x5c': '\u00d6',  // \ -> 'O' umlaut
      '\x5d': '\u00c5',  // ] -> 'A' ring
      '\x5e': '\u00dc',  // ~ -> 'u' umlaut

      '\x60': '\u00e9',  // ` -> 'e' acute

      '\x7b': '\u00e4',  // { -> 'a' umlaut
      '\x7c': '\u00f6',  // | -> 'o' umlaut
      '\x7d': '\u00e5',  // } -> 'a' ring
      '\x7e': '\u00fc',  // ~ -> 'u' umlaut
    });

/**
 * French character map.
 * http://vt100.net/docs/vt220-rm/table2-8.html
 */
hterm.VT.CharacterMaps.DefaultMaps['R'] = new hterm.VT.CharacterMap(
    'french', {
      '\x23': '\u00a3',  // # -> british-pound

      '\x40': '\u00e0',  // @ -> 'a' grave

      '\x5b': '\u00b0',  // [ -> ring
      '\x5c': '\u00e7',  // \ -> 'c' cedilla
      '\x5d': '\u00a7',  // ] -> section symbol (double s)

      '\x7b': '\u00e9',  // { -> 'e' acute
      '\x7c': '\u00f9',  // | -> 'u' grave
      '\x7d': '\u00e8',  // } -> 'e' grave
      '\x7e': '\u00a8',  // ~ -> umlaut
    });

/**
 * French Canadian character map.
 * http://vt100.net/docs/vt220-rm/table2-9.html
 */
hterm.VT.CharacterMaps.DefaultMaps['Q'] = new hterm.VT.CharacterMap(
    'french canadian', {
      '\x40': '\u00e0',  // @ -> 'a' grave

      '\x5b': '\u00e2',  // [ -> 'a' circumflex
      '\x5c': '\u00e7',  // \ -> 'c' cedilla
      '\x5d': '\u00ea',  // ] -> 'e' circumflex
      '\x5e': '\u00ee',  // ^ -> 'i' circumflex

      '\x60': '\u00f4',  // ` -> 'o' circumflex

      '\x7b': '\u00e9',  // { -> 'e' acute
      '\x7c': '\u00f9',  // | -> 'u' grave
      '\x7d': '\u00e8',  // } -> 'e' grave
      '\x7e': '\u00fb',  // ~ -> 'u' circumflex
    });

/**
 * German character map.
 * http://vt100.net/docs/vt220-rm/table2-10.html
 */
hterm.VT.CharacterMaps.DefaultMaps['K'] = new hterm.VT.CharacterMap(
    'german', {
      '\x40': '\u00a7',  // @ -> section symbol (double s)

      '\x5b': '\u00c4',  // [ -> 'A' umlaut
      '\x5c': '\u00d6',  // \ -> 'O' umlaut
      '\x5d': '\u00dc',  // ] -> 'U' umlaut

      '\x7b': '\u00e4',  // { -> 'a' umlaut
      '\x7c': '\u00f6',  // | -> 'o' umlaut
      '\x7d': '\u00fc',  // } -> 'u' umlaut
      '\x7e': '\u00df',  // ~ -> eszett
    });

/**
 * Italian character map.
 * http://vt100.net/docs/vt220-rm/table2-11.html
 */
hterm.VT.CharacterMaps.DefaultMaps['Y'] = new hterm.VT.CharacterMap(
    'italian', {
      '\x23': '\u00a3',  // # -> british-pound

      '\x40': '\u00a7',  // @ -> section symbol (double s)

      '\x5b': '\u00b0',  // [ -> ring
      '\x5c': '\u00e7',  // \ -> 'c' cedilla
      '\x5d': '\u00e9',  // ] -> 'e' acute

      '\x60': '\u00f9',  // ` -> 'u' grave

      '\x7b': '\u00e0',  // { -> 'a' grave
      '\x7c': '\u00f2',  // | -> 'o' grave
      '\x7d': '\u00e8',  // } -> 'e' grave
      '\x7e': '\u00ec',  // ~ -> 'i' grave
    });

/**
 * Norwegian/Danish character map.
 * http://vt100.net/docs/vt220-rm/table2-12.html
 */
hterm.VT.CharacterMaps.DefaultMaps['E'] =
hterm.VT.CharacterMaps.DefaultMaps['6'] = new hterm.VT.CharacterMap(
    'norwegian/danish', {
      '\x40': '\u00c4',  // @ -> 'A' umlaut

      '\x5b': '\u00c6',  // [ -> 'AE' ligature
      '\x5c': '\u00d8',  // \ -> 'O' stroke
      '\x5d': '\u00c5',  // ] -> 'A' ring
      '\x5e': '\u00dc',  // ^ -> 'U' umlaut

      '\x60': '\u00e4',  // ` -> 'a' umlaut

      '\x7b': '\u00e6',  // { -> 'ae' ligature
      '\x7c': '\u00f8',  // | -> 'o' stroke
      '\x7d': '\u00e5',  // } -> 'a' ring
      '\x7e': '\u00fc',  // ~ -> 'u' umlaut
    });

/**
 * Spanish character map.
 * http://vt100.net/docs/vt220-rm/table2-13.html
 */
hterm.VT.CharacterMaps.DefaultMaps['Z'] = new hterm.VT.CharacterMap(
    'spanish', {
      '\x23': '\u00a3',  // # -> british-pound

      '\x40': '\u00a7',  // @ -> section symbol (double s)

      '\x5b': '\u00a1',  // [ -> '!' inverted
      '\x5c': '\u00d1',  // \ -> 'N' tilde
      '\x5d': '\u00bf',  // ] -> '?' inverted

      '\x7b': '\u00b0',  // { -> ring
      '\x7c': '\u00f1',  // | -> 'n' tilde
      '\x7d': '\u00e7',  // } -> 'c' cedilla
    });

/**
 * Swedish character map.
 * http://vt100.net/docs/vt220-rm/table2-14.html
 */
hterm.VT.CharacterMaps.DefaultMaps['7'] =
hterm.VT.CharacterMaps.DefaultMaps['H'] = new hterm.VT.CharacterMap(
    'swedish', {
      '\x40': '\u00c9',  // @ -> 'E' acute

      '\x5b': '\u00c4',  // [ -> 'A' umlaut
      '\x5c': '\u00d6',  // \ -> 'O' umlaut
      '\x5d': '\u00c5',  // ] -> 'A' ring
      '\x5e': '\u00dc',  // ^ -> 'U' umlaut

      '\x60': '\u00e9',  // ` -> 'e' acute

      '\x7b': '\u00e4',  // { -> 'a' umlaut
      '\x7c': '\u00f6',  // | -> 'o' umlaut
      '\x7d': '\u00e5',  // } -> 'a' ring
      '\x7e': '\u00fc',  // ~ -> 'u' umlaut
    });

/**
 * Swiss character map.
 * http://vt100.net/docs/vt220-rm/table2-15.html
 */
hterm.VT.CharacterMaps.DefaultMaps['='] = new hterm.VT.CharacterMap(
    'swiss', {
      '\x23': '\u00f9',  // # -> 'u' grave

      '\x40': '\u00e0',  // @ -> 'a' grave

      '\x5b': '\u00e9',  // [ -> 'e' acute
      '\x5c': '\u00e7',  // \ -> 'c' cedilla
      '\x5d': '\u00ea',  // ] -> 'e' circumflex
      '\x5e': '\u00ee',  // ^ -> 'i' circumflex
      '\x5f': '\u00e8',  // _ -> 'e' grave

      '\x60': '\u00f4',  // ` -> 'o' circumflex

      '\x7b': '\u00e4',  // { -> 'a' umlaut
      '\x7c': '\u00f6',  // | -> 'o' umlaut
      '\x7d': '\u00fc',  // } -> 'u' umlaut
      '\x7e': '\u00fb',  // ~ -> 'u' circumflex
    });

lib.resource.add('hterm/images/copy', 'image/svg+xml;utf8',
'<svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em" viewBox="0 0 48 48" fill="currentColor">' +
'  <path d="M32 2H8C5.79 2 4 3.79 4 6v28h4V6h24V2zm6 8H16c-2.21 0-4 1.79-4 4v28c0 2.21 1.79 4 4 4h22c2.21 0 4-1.79 4-4V14c0-2.21-1.79-4-4-4zm0 32H16V14h22v28z"/>' +
'</svg>'
);

lib.resource.add('hterm/images/icon-96', 'image/png;base64',
'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAStklEQVR42u1dBXjrupL+RzIGmjIf' +
'vAcu42NmZub3lpmZmZmZmRkuMzPDYaYyJG0Sa9b2p2z1eQtp7bzefpv/nKnkkSw7Gg1IshNsDtpo' +
'o4022mijDWp/tlTgzbpJSqYvMoFTC9vjRD5JLb9RYaRkpk22SS28P8pacAaPdZ41KYMCI89YB6wN' +
'3JzQJM3UIGqurfTlKQTAZtqENid5SlNdU804VmbbWQtA6HMkAAdADsBeAJ7mxwIhIhFSXJ9iRPw4' +
'JYDEcqmGWEp1HhCI8gAtpXF7scB1ZRH9E3HObANCNy1AoGTegNDnCdE41tfQDH2t+CINQEpJ9Xp9' +
'7oUDh3+nXK48DYAMIWQmANIkNTn6vP69e3d/zctfeu0nXNexmVn3F0gDAMxMlBoHuht0qnsEEekC' +
'42SdGHmNxgVjgk4bPN04Yui8bhc534cQBH35RKrPN9sGdLnB1/Wuv+HW4f+6/tZvBHAaAJvmKr0A' +
'jJGvyQMw8pLrrvqeT378Ax8UwrKeevoFgEhfjcGGO2JO+iuTt1SW5DHzyraDExyTlWwHjCQ/CAJc' +
'ecU+XHn5xWDmVCGQFAKljsLbx8Ynvv3Bhx7/EQCzurimU04jADLsvK3r73/7W1//g1/6hU++uVqt' +
'0X/dcBcKxRIsy9Ji34DPow2et6FzgcXFKk6fOY83vu4VEFKkDiYHB3roSz73sc+Oj08eOHzk+B9o' +
'MyQABGk0gCIyOt9xHPvaD3/wnT/5VV/+meumpmbwD/98A0qdvVEBNhvMDCJaVXtM01GtVlEs+LBt' +
'C1ngzW98tX/m7Llv/emf+83HarX6vbrfGECQRgBmlLP9Ix961499+zd/5XVj45P407/8FxQ7uiGl' +
'QK1Ww1ZCvR6gXq3AsgQ8zwYzUkMIgXe+/Q1Dd9x5/6duv/P+R7QjprQaIHQd/8orLvnCJz/2/pfm' +
'cj7+6rf+DK5XgOu6sT3dQtBawqjW6lhYXIRlSTAjE/T39eLSS/ZeEwqgE8CiYUV4vQIgTULTyFve' +
'9Or3WJZN/3n9HTh3fgrFjhJmZmawFaGUwkJlEffc9xh83wMYqcFg7Noxinw+l9OBikirAabz7eju' +
'6sxJKTE7W4bn5+D7PrYmtI/gAFJasCwb4IzaBMHzXE8LgBJC4I1GQRKAa4Xo6upEsZiH53nIRYLe' +
'olDMCIIq+nq70dFRAGckgFKpAD+UgBaAgfRRkGvbliwUcoh8ABHFYSfWMnBrxOzL12PwKufzSvV5' +
'5Tpmi5a0IASBQCgWcujs7ABn5AQic+b5rhNlAVAmTliTEwnA990wIxEEdUQYnxjHidMnAUIcBYAB' +
'RqNDdC7BM8t0VtfTnGRd8FKdRIjJcVlCsAbPPA5UAK4rXLJjP7aNbkO9XoPrOrEQWHEm69Kua0ca' +
'YEspvCBQ5toSp9EASCkt27ZF1PlCxBOZOPo5feY0Xpg8jHe/7V3YNjhqjDRac3mMVl1Oo40vtREt' +
'W+2FYwdw/S03YHJ6EkODQ1hcXIQUcaeBlUIWsCwZ+QDLdZxcubKAtBpgNmzZliUa6yLMKiRGoBR2' +
'79yN6666FlJYABgvRhAIncUSHn/iCdQrAZjjSAiKFQQRVEhZIRJASJEACICmlAKQUtqhBETjw5ij' +
'uFqr4oWjBwHmF7/jVUHc6aRNXxAoZA3PdYXruvlldJfTaIATaQA4KU/CzNwMDp84DOYXf+hZXiij' +
'hJz+DK0QAEd+RYTOOAcgMw0g24oskNYAIoCXxDpbnsOxM8fB5qacwKZD+3WQcS+VxQrYYXNVNGMh' +
'I1odiIRQSHb8BmbCpgZYjmVLYi0ANmxQNKpOj50FFOB3WnDzEpOnFkGbuOXPimG5Ap0jLqZOLiKo' +
'MyIsVhfB9lLEpFSQ+S26jh2Fo/n0YagRCUlLRhpAAIMIyWl9vBinAkbfoIPXf+0wnrlxAs/dPInK' +
'VB1CUOsFkdhD6Nnp49oP98EvWfjvnzqGak0hVlwwFJsaoADK9vq2Y0eOOKUGJLTAjjQgFgBAy/gT' +
'vbGIyXC0nX66jJd+YgC7X1nCo39/AccfmUVQU1F5y0d9rsvGJW/txuXv7oGqMx7+2/OoVxWIzE5S' +
'OkfaBBGyhGPHc4G8YYjT+wDLDgUgJbQPWDGuL0/VcefvnMLRB2dw3Uf78dZv345D90zjsX++gPGj' +
'C7peC8yNI7DjpSVcE476rlEPB++awmP/dCEaEMtqbAP1Fqzkhn0VaUAegMzABJkaIMG8epNEiE3R' +
'0funce75Mi4NR+MV7+3B6NUFPPnvY3jupslISJkKoW9PDld/sA+7Xt6B8SMV3Pjzx3Di0TkENQaJ' +
'5A1qM8VRljKPgpg58pcNHyCz0ADSTnhNDTBBglCZruPhvz+PY4/M4Jqwg6772AB2vqwDd/zmKYwd' +
'WQAJpMalb+vGSz81AA6Ah/76HJ69KfI7tej6K7RPUKwaWQT1FmiAlJEJykXZZh5cE02FoaEJkpYE' +
'wGsKwNQGAnDhQAUP/915TJ5YwPCleZSG3WwWvwgYvryAYr8Tm5wn/2Mc5cm481c9RzXWobQPyBpS' +
'ikgDGgJAVvMARzY0AARwc7Y5Ckn3vK4TV7+/D5YncN+fnsWpJ+cgsnDICnj0n85DSOCSUBO6Rl08' +
'8g8XcObZ+VgjSKweKRG1xgcIEQnA9QE46aMgwwlHAmBuOFFepeMRd8rI1cU4FBzYn8exh2bw6D9e' +
'wNihCjgrR0wI21vAzb9yIrT/pfha7/y+nXj+5gk8EWrDzJlF/WxQUgMUwEtREGW/5RlpgJdaABq0' +
'pAGicYFVFaBzxMGV7+vFvtd3YfpsFbf+6ok4KqovxqFoph+YBBAsMg7cPonTT83jsnd247J39IQR' +
'UUcceR28cxrVcrBUX2sAa1Nar7dCAwhevCkDN7UADB9gSyEBaBVYYeT37PTw9u/aAbcg8Pi/XMAz' +
'109gfqLhFAktgX46LbrOg395DscemAnD0X68+suGQ+3L4Y7fOhVHRA00nDBRa3wAEGuAA8DbqABI' +
'kyEA2xFSrBHHM2xf4Ozz82HIOb5kbgSh1TDv69wLZdz0S8dxUTgRHLwkD2HRkgCIdBi6NBPmVpgg' +
'L7krBkrnA6xIA0Qjfl4x9Bw7XInDzHo1hblJbZYoNkvP3zqFw/fPIKgqGNC7aNoEtUQDEJkg23Ec' +
'v1qtrhkFiWYeTYzCUCEEeI15QDTSgjpnMerTmyUB1CsKrGACyvABQb1VAnAt13V8NAHRxGqotEMI' +
'QUbJFgGtMhNuqQa4Ui9HbEgDKFknioKIhC4kbGUwFBhsOGHO/AqhCxAh5dOsBZFBMoqCGhpARJv7' +
'ihul35oEt84E6U0ZCv1APp0T1tACsIhEpquZQhJsT2C9UAGjtqA2vDnPzOD/NUEqymcOJ94TcPJZ' +
'zYSFHYKIjHlA+iXk/kvyeO1XDENYtK6J16kn53H375+OBbFukBkFtWoewHAdJ1qQKwAQWcyEtQaQ' +
'4QPSmk6KZ6gXDlVAcn0x9vTpxTSjdhkBcOYmSO+KNTZlKK0GWHYoASJkZoJIABPHFnDbb5zEFxts' +
'hqEtMkG2rfcEtAZsJAoimBpgGRqg062KVmsAmBH2V2NfWKZ1woxYAyIBwFABXma+nE30wytV4rU/' +
'OK9xLWaGUmpJAHE+awEDUsrGnoCERsooyJYALfPaOEHNByBl7BGwKQsy8kYLUZ1kOTXyZprgUYJH' +
'SBzrctLHDZ6huflCLt61qtWDWAMawsgOWgCe5+v+JYN4vT6AtAbIpSCIGuEcRoaG8TrXRcwzCeZ7' +
'u2gcm4QIZn0QEudC5wGYdYxUt2PyjRSAyWsc6mvW6hW0CnpXzAdgQ6NZAdByJsgKBQAQGCp+oQFQ' +
'8ePdhUIBxWJxXfrJYKQHNRUMMK9kuwhzc3O4eO+eeLQqpbLfFfMaAgAnhdDccrSpAZYtAUApxujI' +
'EN725lfg3//7bvT19cOyLJhg44/ZCTo1y40yI79qmT4/5un2jTx0+XLtmAOAlUJXVx6ve83LdFkr' +
'dsWMTZkUTpikjFyAJUxHFr6oDc918cDDT6KyMB8xzVFpmBpAGGZHiCgVZgoRphSlQkCQTvXxEhFk' +
'lMolXnyseY28NMtlIjXaCzsHO7aPoFDIQ6nWCMDzXS2AdJvybMl4HiaSLyK89S2vxRte/wrU6vXG' +
'IFrzOxdWTZcaMNtCgq15a9vNtWyTMjUncwEguSu2ISesO3vp3YDkE2ZSypiyQMO0JO331gTFryoJ' +
'IXylVLrFOCtEpAHmaG5jbQ3Qb8r45XKFN2qCOCJpSUsxi/n5SlOP8rXB0WpoUgC8HgGwQYqI7AMH' +
'j1G9zk2Ea20wgI5iPhqs8dMk6/26GrOyiqharc16nlffvn3EaWtAc/BcBw8+/Ojc+PjkKaMvuWkN' +
'ME+YnZ17+rnnDxweHOi9iCM+gzbLOXLrG8piu46JIO5/4NHD9XpwbEPfEqjJ01R0XecDYcz8lvhF' +
'MSEkwJIBaU76AZA+SsST5oHOmidqvsHQieYk6ya/ucysT/pPon6yLum/5tXN4uV45ocAKHEeWFdQ' +
'YcpKKb4wNnH/xMTUjwGYArBofLHfuhfjeO+eXbu+/ms+946JyWl16NAxWmV80AZGImW+M0z/dxWU' +
'NbvJNQzaqNK4ro13v/NN9C//doP4gz/+mxKAWWNQb2hHzL/s0n1XDfT3W3fe8wRAVmLytCE56HM3' +
'LL/E+bRqb+niFZ9rSvD0nnHzd2Y+M3vs5Ckwc/S9QQMABgGc0cvS9fU8migi0uUDey7asfvQ4eMQ' +
'louuzs74Am0sL4TZQhHHTpzG8FB/qdRR3DU9M/sUgJqmphfjhJaa9H1v9/Ztw/1PPn0QtWoNs7Oz' +
'WBltATiOixMnzuCS/bvtgTBwCQXg6s5fNLdTmnkuSAKww0WrS7q6St7E5Ax6egbWWHpow3EcnDs/' +
'EX8v6fDw4J4XDhzxASwAEOvSAF2Wu2j3jssAQqVSQ6+ULTQ/W3+pQy/dYHauEi9Sbhsd2gGgqB2x' +
'BEDN+gCpy3rCCGjP5OQ0FHO0idGeDTexHRkoxvjEJHZsGxkE0APgnO5TYc6x1hKAIKJtu3dtGzp1' +
'+hyKxY5oB6wpDWibIRenTp3D6OhQl5RyMAiC5w0TRCtpACW+rM8aGR7cPzTYX3ziqQPw/dzmm4gt' +
'YOaYGZ7n4cTJs3jVK67xw++l23723AVtURLhaFIDEuGnG47+S33fo8mpWZQ6XUxPT6ONtfeD7dgR' +
'j6NQyNHQ0MCOUAA2ANmMBpAhhGJo//eFy6lgFsjn823zsw6cnhyHUhw74kcfe8ozfMCKAkjOAYb2' +
'7tk5cubsBTiuF3v35h1w2xwpRmgxZrBj+/AIgA4AY7pfsZYGyIi6uzv3hHOArocefQbMwNTUVFsD' +
'mjdDIUmcDgfv6OhwH4CIjie0gJfVAF3J2bVjWzgB65TnL0ygs7NrnROwthZUqzWcPHUOV1y2txiu' +
'JA/Pzc0/spYJEob5ye/Zs/NiZka5XEVPr4821gfP9xAN3nA9yB4c6Nt+cG5eLvPGDCdNUKNS7769' +
'u3ZGX1NfqwfR+s//C/PDnH5TRq+kxun8fBkdxQJGhgd2Hjx01BBAwgQl7L/I5fyd4RJE3+TUdNjI' +
'PKSc0AJg/T+JxNNnK5Uly3VuterJOpzh3hmts5DWKExy3/j6l2J4eAAjI4PbjG9UF6YQrMaBWRCu' +
'fu4fHRn0Bvp7USzkUS4vmD9as+IP3cSHWL5eXGTUizk6v/IDubodM7+++qs+ENbsg2RxLlE/5pr1' +
'Ew8H25aFnp6u2CFvGx0e0JHQGdMEJTWgkTo7d4xe3NfXg1KpiLe86TWg9ONtc3eKuVX3yatei5m1' +
'AIa6pRT9QaCeb2YporBzx7Zd0chnRkgKbaSLsMLZcK6/rzecU53n5TSAEkw/HPkFy86BpJtq3LRB' +
'IK6jq7NDhPOqPi0A0+cuuxq6EMas5bGJaVQWFWgTbrqVTdEX9f4ZvmfB9/3Il5bW2hNmnZbDB4om' +
'Lpw/h7n5RYCa+3E0ToY4Jp9XiGSYk/WMvHmlxDEn7yN5ffN4mTzrM808G+0leJqVbG81njbfjFJH' +
'Hr4no4lZ3fjRT06GoWxQ+eFHn7rTz/1Tv5QSrBQpZrAmfVMaQJyNOXHOPESjztJfs54uxFJWl5q1' +
'zYuZRzD+RzAPEufoJFln2TyMv8axwUheJPGRVSMFEHe4ZckqMy8cOXLin5f7xVUyyPypwhKAHp13' +
'IjJCVW4iHGAz30Q5mmx3I+dwyvbWE36x0ck1AFW9Gb+g06qmWkMQVuLEQEtuVldyjR/vFJqyjxNb' +
'6+mTA6DV96HMvkx0ej2pAZZxoBL5QJ8oDKIW3jxnfA5twj1xUhPMjjd9wGpOOEgIgUzaxFG8RZ4F' +
'Tgxos9N1atajtd+S1LytA26p8NKbQE7/0+BtpNakNtpoo4022vgf7lRPtKCE39oAAAAASUVORK5C' +
'YII='
);
