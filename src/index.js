import { guid, hexToRGB } from "common-helpers";
import { handleInput } from "input-helper";

const THE_ALPHABET = "A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z";

const DEF_COL_WIDTH = 100;
const DEF_ROW_HEIGHT = 24;
const MIN_SCROLL_TRACK = 48;

const globalInstances = {};
const retainedImages = {};

export const CELL_FORMATS = {
    DEFAULT: 0,
    TEXT: 1,
    NUMBER: 2,
    CURRENCY: 3,
    PERCENT: 4,
    DATE: 5,
    TIME: 6,
    DATE_TIME: 7
};

export const CELL_ALIGNMENTS = {
    DEFAULT: 1,
    LEFT: 2,
    CENTER: 3,
    RIGHT: 4,
    JUSTIFY: 5
};

export class ApeGrid {
    constructor(holder, options = {}) {

        const instance = this;

        instance.holder = holder;
        instance.options = options || {};

        instance.id = guid();
        
        instance.canvas = document.createElement("canvas");
        instance.canvas.style.imageRendering = "pixelated";
        instance.canvas.style.width = "100%";
        instance.canvas.style.height = "100%";
        instance.canvas.style.position = "absolute";

        instance.context = instance.canvas.getContext("2d");
        instance.context.imageSmoothingEnabled = false;

        instance.holder.appendChild(instance.canvas);

        instance.needsDraw = true;
        instance.attached = true;

        instance.scale = 1;
        instance.width = 1;
        instance.height = 1;
        instance.totalColumns = 24;
        instance.totalRows = 1000;
        instance.lastMouseScroll = 0;

        instance.manipulatingVBar = false;
        instance.manipulatingHBar = false;
        
        instance.vScrollShowing = false;
        instance.hScrollShowing = false;

        instance.currencyCode = "USD";

        instance.theme = options.theme || "#2196F3";
        instance.gridlines = options.gridlines || true;
        instance.rowHeaders = options.rowHeaders || true;
        instance.colHeaders = options.colHeaders || true;
        instance.selMode = options.selMode || "default";
        instance.defFont = options.defFont || "Arial";
        instance.minRow = options.minRow || 0;
        instance.minCol = options.minCol || 0;
        instance.tag = options.tag || "worksheet tag";
        instance.canResize = options.canResize || true;

        instance.origin = {
            row: instance.minRow,
            col: instance.minCol
        };

        instance.listeners = {};
        instance.colSizes = {};
        instance.rowSizes = {};
        instance.retainedValues = {};

        instance.isSelecting = false;

        instance.curSelection = {
            start: null,
            end: null,
            tmp: null
        };

        instance.resizePing = null;

        setupInstanceListeners(instance);

        new ResizeObserver(function() {
            instance.pingForResize();
        }).observe(instance.holder);

        new MutationObserver(function() {
            instance.checkIfAttached();
        }).observe(instance.holder, { attributes: true, childList: true, subtree: true });

        globalInstances[instance.id] = instance;
    }

    dataChanged() {
        this.retainedValues = {};
        this.needsDraw = true;
    }

    setColumnSizes(sizes) {
        if(sizes) {
            this.colSizes = sizes;
        } else {
            this.colSizes = {};
        }

        this.needsDraw = true;
    }

    setRowSizes(sizes) {
        if(sizes) {
            this.rowSizes = sizes;
        } else {
            this.rowSizes = {};
        }

        this.needsDraw = true;
    }

    setSize(rows, cols) {
        this.totalColumns = cols;
        this.totalRows = rows;

        this.needsDraw = true;
    }

    setMinRow(min) {
        this.minRow = parseInt(min);

        if(isNaN(this.minRow)) {
            this.minRow = 0;
        }

        if(this.origin.row < this.minRow) {
            this.origin.row = this.minRow;
        }

        this.needsDraw = true;
    }

    setMinCol(min) {
        this.minCol = parseInt(min);

        if(isNaN(this.minCol)) {
            this.minCol = 0;
        }

        if(this.origin.col < this.minCol) {
            this.origin.col = this.minCol;
        }

        this.needsDraw = true;
    }

    setSelection(selection) {
        if(selection) {
            this.curSelection = selection;

            if(!this.curSelection.tmp) {
                this.curSelection.tmp = this.curSelection.start;
            }
        } else {
            this.curSelection = {
                start: null,
                end: null,
                tmp: null
            };
        }

        this.needsDraw = true;
    }

    on(evt, func) {
        if(func) {
            this.listeners[evt] = func;
        } else {
            delete this.listeners[evt];
        }
    }

    pingForResize() {
        const instance = this;

        if(instance.resizePing) {
            clearTimeout(instance.resizePing);
        }

        instance.resizePing = setTimeout(function() {
            instance.resize();
        }, 40);
    }

    clearResizePing() {
        const instance = this;

        if(instance.resizePing) {
            clearTimeout(instance.resizePing);
        }

        instance.resizePing = null;
    }

    resize() {
        this.clearResizePing();

        if(!this.holder || !this.canvas || !this.attached) {
            return;
        }

        resizeGrid(this);
    }

    checkIfAttached() {
        if(this.holder && this.canvas) {
            const attached = document.body.contains(this.holder);

            if(attached) {
                const hasCanvas = this.holder.contains(this.canvas);

                if(!hasCanvas) {
                    this.attached = false;
                }
            } else {
                this.attached = false;
            }
        }

        if(!this.attached) {
            this.clearResizePing();

            this.canvas.remove();
            this.canvas = null;
            this.context = null;
            this.holder = null;

            delete globalInstances[this.id];
        }
    }

    render() {
        if(!this.needsDraw || !this.canvas || !this.context || !this.attached) {
            return;
        }

        renderGrid(this);
    }
}

function setupInstanceListeners(instance) {
    handleInput({
        element: instance.canvas,
        down: function(e) {
            gridPointerDown(instance, e);
        },
        move: function(e) {
            gridPointerMove(instance, e);
        },
        up: function(e) {
            gridPointerUp(instance, e);
        }
    });

    instance.canvas.addEventListener("contextmenu", function(e) {
        e.preventDefault();
        e.stopPropagation();
    });

    instance.canvas.addEventListener("mousewheel", function(e) {
        const now = new Date().getTime();
        const diff = now - instance.lastMouseScroll;

        if(diff < 50) {
            return;
        }

        const yDelta = e.deltaY / 12;
        const xDelta = e.deltaX / 12;

        let scrollXDelta = Math.floor(xDelta);
        let scrollYDelta = Math.floor(yDelta);

        if(yDelta > 0) {
            scrollYDelta = Math.ceil(yDelta);
        }

        if(xDelta > 0) {
            scrollXDelta = Math.ceil(xDelta);
        }

        instance.origin.col += scrollXDelta;
        instance.origin.row += scrollYDelta;

        if(instance.origin.row < instance.minRow) {
            instance.origin.row = instance.minRow;
        }

        if(instance.origin.row > instance.totalRows) {
            instance.origin.row = instance.totalRows;
        }

        if(instance.origin.col < instance.minCol) {
            instance.origin.col = instance.minCol;
        }

        if(instance.origin.col > instance.totalColumns) {
            instance.origin.col = instance.totalColumns;
        }

        instance.lastMouseScroll = now;

        instance.needsDraw = true;
    });
}

function resizeGrid(grid) {

    let ratio = 1;

    if(window.devicePixelRatio) {
        ratio = window.devicePixelRatio;
    }

    const width = grid.holder.offsetWidth;
    const height = grid.holder.offsetHeight;

    grid.height = Math.floor(height * ratio);
    grid.width = Math.floor(width * ratio);

    grid.canvas.width = grid.width;
    grid.canvas.height = grid.height;

    grid.scale = ratio;
    grid.needsDraw = true;

    if(grid.listeners.resize) {
        grid.listeners.resize();
    }
}

function globalRender() {

    requestAnimationFrame(globalRender);

    for(const instance of Object.values(globalInstances)) {
        instance.render();
    }
}

function gridPointerDown(grid, e) {
    if(!grid.attached) {
        return;
    }

    const x = e.x;
    const y = e.y;

    if(grid.vScrollShowing && x > (grid.width - (8 * grid.scale))) {
        grid.manipulatingVBar = true;
        gridVertBarInput(grid, y);
        return;
    }

    if(grid.hScrollShowing && y > (grid.height - (8 * grid.scale))) {
        grid.manipulatingHBar = true;
        gridHorizBarInput(grid, x);
        return;
    }

    const coord = getCellForCoord(grid, x, y);

    if(coord) {

        if(coord.col != "-A" && coord.row > -1) {

            let startCol = coord.col;
            let endCol = coord.col;

            if(grid.selMode == "row") {
                startCol = "A";
                endCol = "Z";
            }

            grid.curSelection.start = {
                col: startCol,
                row: coord.row
            };

            grid.curSelection.tmp = {
                col: endCol,
                row: coord.row
            };

            grid.curSelection.end = null;
            
            grid.isSelecting = true;
            grid.needsDraw = true;
        }

        if(e.which && e.which == 3) {
            if(grid.listeners.contextMenu) {
                grid.listeners.contextMenu(coord.col, coord.row, e.pageX, e.pageY);
                
            }
        }
    }
}

function gridPointerMove(grid, e) {
    if(!grid.attached) {
        return;
    }

    const x = e.x;
    const y = e.y;

    if(grid.manipulatingVBar) {
        gridVertBarInput(grid, y);
        return;
    }

    if(grid.manipulatingHBar) {
        gridHorizBarInput(grid, x);
        return;
    }

    const coord = getCellForCoord(grid, x, y);

    if(grid.isSelecting && grid.curSelection.start) {

        if(coord.col != "-A" && coord.row > -1) {
            let endCol = coord.col;
            let endRow = coord.row;

            if(grid.selMode == "row") {
                endCol = "Z";
                endRow = grid.curSelection.start.row;
            }

            grid.curSelection.tmp = {
                col: endCol,
                row: endRow
            };

            grid.curSelection.end = null;
            grid.needsDraw = true;
        }
    }

    if(grid.listeners.hover) {
        grid.listeners.hover(coord.col, coord.row, e.pageX, e.pageY);
    }
}

function gridPointerUp(grid) {
    if(!grid.attached) {
        return;
    }

    grid.manipulatingVBar = false;
    grid.manipulatingHBar = false;

    if(grid.isSelecting) {
        grid.isSelecting = false;

        grid.curSelection.end = grid.curSelection.tmp;
        grid.needsDraw = true;

        if(grid.listeners.selection) {
            grid.listeners.selection(grid.curSelection.start, grid.curSelection.end);
        }
    }
}

function renderGrid(grid) {
    let backOpac = 0.05;

    if(grid.selMode != "default") {
        backOpac = 0.15;
    }

    const gridThemeRGBAColor = hexToRGB(grid.theme);
    const gridThemeRGBACSS = "rgba(" + gridThemeRGBAColor.r + "," + gridThemeRGBAColor.g + "," + gridThemeRGBAColor.b + ", " + backOpac + ")";

    let defTextColor = "#000000";

    if(document.body.classList.contains("adlDark")) {
        defTextColor = "#ffffff";
    }

    grid.canvas.width = grid.width;
    grid.canvas.height = grid.height;

    grid.context.clearRect(0, 0, grid.width, grid.height);

    let cell1 = null;
    let cell2 = null;

    let startX = 0;
    let startY = 0;
        
    let endX = 0;
    let endY = 0;

    let wholeWidth = 0;
    let wholeHeight = 0;

    let showingRows = 0;
    let showingCols = 0;

    let firstShowRow = -1;
    let firstShowCol = -1;

    // first render selection backfill
    if(grid.curSelection && grid.curSelection.start && grid.curSelection.tmp) {
        cell1 = getCoordsForCell(grid, grid.curSelection.start.col, grid.curSelection.start.row);
        cell2 = getCoordsForCell(grid, grid.curSelection.tmp.col, grid.curSelection.tmp.row);

        if(cell1.x > cell2.x) {
            startX = cell2.x;
            endX = cell1.x + cell1.width;
        } else {
            startX = cell1.x;
            endX = cell2.x + cell2.width;
        }

        if(cell1.y > cell2.y) {
            startY = cell2.y;
            endY = cell1.y + cell1.height;
        } else {
            startY = cell1.y;
            endY = cell2.y + cell2.height;
        }

        if(grid.selMode == "row") {
            endX = grid.width * grid.scale;
        }

        wholeWidth = endX - startX;
        wholeHeight = endY - startY;

        grid.context.fillStyle = gridThemeRGBACSS;
        grid.context.fillRect(startX, startY, wholeWidth, wholeHeight);

    }

    grid.context.fillStyle = "rgba(130,130,130,0.075)";

    if(grid.colHeaders) {
        grid.context.fillRect(0, 0, grid.width, 24 * grid.scale);
    }
        

    if(grid.rowHeaders) {
        grid.context.fillRect(0, 25, 36 * grid.scale, grid.height - (24 * grid.scale));
    }

    grid.context.lineWidth = grid.scale;
    grid.context.strokeStyle = "rgba(130,130,130,0.35)";

    if(grid.colHeaders) {
        const useY = Math.floor(24 * grid.scale) + 0.5;

        grid.context.beginPath();
        grid.context.moveTo(0, useY);
        grid.context.lineTo(grid.width, useY);
        grid.context.stroke();
    }

    let curColX = 0;

    if(grid.rowHeaders) {
        const useX = Math.floor(36 * grid.scale) + 0.5;

        grid.context.beginPath();
        grid.context.moveTo(useX, 0);
        grid.context.lineTo(useX, grid.height);
        grid.context.stroke();

        curColX = 37 * grid.scale;
    }

    const defColWidth = DEF_COL_WIDTH * grid.scale;
    const defRowHeight = DEF_ROW_HEIGHT * grid.scale;

    grid.context.font = (12 * grid.scale) + "px " + grid.defFont;
    grid.context.textAlign = "center";

    grid.context.fillStyle = defTextColor;

    let firstRow = true;

    const cellsNeeded = [];

    for(let c = grid.origin.col; c <= grid.totalColumns; c++) {

        showingCols++;

        if(firstShowCol == -1) {
            firstShowCol = c;
        }

        let thisColWidth = defColWidth;
        const thisColName = getColumnNameForIndex(c);

        if(grid.colSizes[thisColName] != undefined && grid.colSizes[thisColName] != null) {
            thisColWidth = parseInt(grid.colSizes[thisColName]) * grid.scale;
        }

        grid.context.font = (12 * grid.scale) + "px " + grid.defFont;
        grid.context.textAlign = "center";
        grid.context.fillStyle = defTextColor;

        const colLineX = Math.floor(curColX + thisColWidth) + 0.5;

        if(colLineX > grid.width + thisColWidth) {
            break;
        }

        const halfColWidth = Math.floor(colLineX + thisColWidth / 2);

        if(grid.colHeaders) {
            grid.context.fillText(thisColName, halfColWidth - thisColWidth, 18 * grid.scale);
        }

        if(grid.gridlines) {
            grid.context.beginPath();
            grid.context.moveTo(colLineX, 0);
            grid.context.lineTo(colLineX, grid.height);
            grid.context.stroke();
        }
            
        curColX += thisColWidth;

        let curRowY = 0;

        if(grid.colHeaders) {
            curRowY = 25 * grid.scale;
        }

        for(let r = grid.origin.row; r <= grid.totalRows; r++) {

            if(firstRow) {
                showingRows++;

                if(firstShowRow == -1) {
                    firstShowRow = r;
                }
            }

            let thisRowHeight = defRowHeight;

            if(grid.rowSizes[r]) {
                thisRowHeight = parseInt(grid.rowSizes[r]) * grid.scale;
            }

            const rowLineY = Math.floor(curRowY + thisRowHeight) + 0.5;

            if(rowLineY > grid.height + thisRowHeight) {
                break;
            }

            const halfLineHeight = Math.floor(thisRowHeight / 2);

            if(c == grid.origin.col) {
                grid.context.font = (12 * grid.scale) + "px " + grid.defFont;
                grid.context.textAlign = "center";
                grid.context.fillStyle = defTextColor;

                if(grid.rowHeaders) {
                    grid.context.fillText(r, 18 * grid.scale, ((rowLineY - halfLineHeight) + (6 * grid.scale)));
                }

                if(grid.gridlines) {
                    grid.context.beginPath();
                    grid.context.moveTo(0, rowLineY);
                    grid.context.lineTo(grid.width, rowLineY);
                    grid.context.stroke();
                }
            }
                
            if(grid.listeners.cellValue) {
                cellsNeeded.push({
                    col: thisColName,
                    row: r,
                    x: curColX,
                    y: curRowY,
                    width: thisColWidth,
                    height: thisRowHeight,
                    cIdx: c
                });
            }

            curRowY += defRowHeight;
            firstRow = false;
        }

            
    }

    for(const cell of cellsNeeded) {
        renderGridCell(grid, cell.col, cell.row, cell.x, cell.y, cell.width, cell.height, defTextColor, cell.cIdx);
    }

    // render selection boxes
    if(grid.curSelection && grid.curSelection.start && grid.curSelection.tmp) {

        if(grid.selMode == "default") {
            grid.context.lineWidth = grid.scale;
            grid.context.strokeStyle = grid.theme;
    
            const lSX = Math.floor(startX) + 0.5;
            const lSY = Math.floor(startY) + 0.5;
    
            const lEX = Math.floor(endX) + 0.5;
            const lEY = Math.floor(endY) + 0.5;
    
            grid.context.beginPath();
            grid.context.moveTo(lSX, lSY);
            grid.context.lineTo(lSX, lEY);
            grid.context.lineTo(lEX, lEY);
            grid.context.lineTo(lEX, lSY);
            grid.context.lineTo(lSX, lSY);
            grid.context.stroke();
    
            grid.context.lineWidth = grid.scale * 2;
    
            grid.context.beginPath();
            grid.context.moveTo(cell1.x, cell1.y);
            grid.context.lineTo(cell1.x, cell1.y + cell1.height);
            grid.context.lineTo(cell1.x + cell1.width, cell1.y + cell1.height);
            grid.context.lineTo(cell1.x + cell1.width, cell1.y);
            grid.context.lineTo(cell1.x, cell1.y);
            grid.context.stroke();
        }

            
    }

    grid.vScrollShowing = false;
    grid.hScrollShowing = false;

    renderScrollbars(grid, showingRows, showingCols, firstShowRow, firstShowCol);
        
    grid.needsDraw = false;
}

function gridVertBarInput(grid, y) {
    const per = y / grid.height;
    const theRow = Math.round(grid.totalRows * per);

    grid.origin.row = theRow;
    grid.needsDraw = true;
}

function gridHorizBarInput(grid, x) {
    const per = x / grid.width;
    const theCol = Math.round(grid.totalColumns * per);

    grid.origin.col = theCol;
    grid.needsDraw = true;
}

function getCellForCoord(grid, x, y) {

    x *= grid.scale;
    y *= grid.scale;

    const result = {
        col: "-A",
        row: -1
    };

    let offset = 0;

    if(grid.rowHeaders) {
        offset = 37;
    }

    let curColX = offset * grid.scale;
    const defColWidth = DEF_COL_WIDTH * grid.scale;
    const defRowHeight = DEF_ROW_HEIGHT * grid.scale;

    for(let c = grid.origin.col; c <= grid.totalColumns; c++) {
        let thisColWidth = defColWidth;
        const thisColName = getColumnNameForIndex(c);

        if(grid.colSizes[thisColName]) {
            thisColWidth = parseInt(grid.colSizes[thisColName]) * grid.scale;
        }

        const colLineX = Math.floor(curColX + thisColWidth) + 0.5;

        if(colLineX > grid.width + thisColWidth) {
            break;
        }

        if(x > curColX && x < colLineX) {
            result.col = getColumnNameForIndex(c);
        }

        let curRowY = 0;

        if(grid.colHeaders) {
            curRowY = 25 * grid.scale;
        }

        for(let r = grid.origin.row; r <= grid.totalRows; r++) {

            let thisRowHeight = defRowHeight;

            const rowLineY = Math.floor(curRowY + thisRowHeight) + 0.5;

            if(rowLineY > grid.height + thisRowHeight) {
                break;
            }

            if(y > curRowY && y < rowLineY) {
                result.row = r;
            }

            curRowY += thisRowHeight;
        }

        curColX += thisColWidth;
    }

    return result;
}

function getCoordsForCell(grid, col, row) {
    const result = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
    };

    let offset = 0;

    if(grid.rowHeaders) {
        offset = 37;
    }

    let curColX = offset * grid.scale;
    const defColWidth = DEF_COL_WIDTH * grid.scale;
    const defRowHeight = DEF_ROW_HEIGHT * grid.scale;

    for(let c = grid.origin.col; c <= grid.totalColumns; c++) {
        let thisColWidth = defColWidth;
        const thisColName = getColumnNameForIndex(c);

        if(grid.colSizes[thisColName]) {
            thisColWidth = parseInt(grid.colSizes[thisColName]) * grid.scale;
        }

        const colLineX = Math.floor(curColX + thisColWidth) + 0.5;

        if(colLineX > grid.width + thisColWidth) {
            break;
        }

        const colName = getColumnNameForIndex(c);

        if(colName == col) {
            result.x = curColX;
            result.width = thisColWidth;
        }

        let curRowY = 0;

        if(grid.colHeaders) {
            curRowY = 25 * grid.scale;
        }

        for(let r = grid.origin.row; r <= grid.totalRows; r++) {

            let thisRowHeight = defRowHeight;

            const rowLineY = Math.floor(curRowY + thisRowHeight) + 0.5;

            if(rowLineY > grid.height + thisRowHeight) {
                break;
            }

            if(r == row) {
                result.y = curRowY;
                result.height = thisRowHeight;
            }

            curRowY += thisRowHeight;
        }

        curColX += thisColWidth;
    }

    return result;
}

export function getColumnNameForIndex(idx) {
    const letters = THE_ALPHABET.split(",");

    if(idx < 0) {
        return "-A";
    }

    if(idx > 25) {
        const firstLetter = letters[Math.floor(idx / 26) - 1];
        const secondLetter = letters[idx % 26];

        return firstLetter + secondLetter;
    }

    return letters[idx];
}

export function getIndexForColumnName(name) {
    const letters = THE_ALPHABET.split(",");

    if(name.length == 1) {
        return letters.indexOf(name);
    }

    if(name.length == 2) {
        const firstLetter = letters.indexOf(name[0]) + 1;
        const secondLetter = letters.indexOf(name[1]);

        return (firstLetter * 26) + secondLetter;
    }

    return -1;
}

function renderScrollbars(grid, showingRows, showingCols, firstShowRow, firstShowCol) {
    if(showingRows < grid.totalRows) {
        grid.vScrollShowing = true;

        grid.context.fillStyle = "rgba(130, 130, 130, 0.3)";

        const vWidth = 8 * grid.scale;
        const vX = grid.width - vWidth;

        grid.context.fillRect(vX, 0, vWidth, grid.height);

        const trackHPer = showingRows / grid.totalRows;
        let trackHeight = Math.round(grid.height * trackHPer);

        if(trackHeight < MIN_SCROLL_TRACK * grid.scale) {
            trackHeight = MIN_SCROLL_TRACK * grid.scale;
        }

        let trackYPer = firstShowRow / (grid.totalRows + showingRows);

        if(trackYPer < 0) {
            trackYPer = 0;
        }

        if(trackYPer > 100) {
            trackYPer = 100;
        }
        
        const trackY = Math.round(grid.height * trackYPer);

        grid.context.fillStyle = grid.theme;
        grid.context.fillRect(vX, trackY, vWidth, trackHeight);
    }

    if(showingCols < grid.totalColumns) {
        grid.hScrollShowing = true;

        grid.context.fillStyle = "rgba(130, 130, 130, 0.3)";

        const vHeight = 8 * grid.scale;
        const vY = grid.height - vHeight;

        let barWidth = grid.width;

        if(grid.vScrollShowing) {
            barWidth -= 8 * grid.scale;
        }

        grid.context.fillRect(0, vY, barWidth, vHeight);

        const trackWPer = showingCols / grid.totalColumns;
        let trackWidth = Math.round(barWidth * trackWPer);

        if(trackWidth < MIN_SCROLL_TRACK * grid.scale) {
            trackWidth = MIN_SCROLL_TRACK * grid.scale;
        }

        let trackXPer = firstShowCol / (grid.totalColumns + showingCols);

        if(trackXPer < 0) {
            trackXPer = 0;
        }

        if(trackXPer > 100) {
            trackXPer = 100;
        }

        const trackX = Math.round(barWidth * trackXPer);

        grid.context.fillStyle = grid.theme;
        grid.context.fillRect(trackX, vY, trackWidth, vHeight);
    }
}

function renderGridCell(grid, col, row, cX, rY, cW, rH, defColor, cIdx) {
    const cellValue = grid.listeners.cellValue(grid.tag, col, row);

    if(cellValue) {

        let defAlign = CELL_ALIGNMENTS.LEFT;

        if(cellValue.f) {
            if(cellValue.f == CELL_FORMATS.NUMBER || cellValue.f == CELL_FORMATS.CURRENCY || cellValue.f == CELL_FORMATS.PERCENT) {
                defAlign = CELL_ALIGNMENTS.RIGHT;
            }
        }

        let alignCode = cellValue.a || defAlign;

        let cellAlign = "left";

        if(alignCode == CELL_ALIGNMENTS.CENTER) {
            cellAlign = "center";
        }

        if(alignCode == CELL_ALIGNMENTS.RIGHT) {
            cellAlign = "right";
        }

        if(alignCode == CELL_ALIGNMENTS.JUSTIFY) {
            cellAlign = "justify";
        }

        let cellWidth = cW;
        let cellHeight = rH;

        let isMerged = false;

        if(cellValue.cw && cellValue.cw > 1) {
            for(let checkC = cIdx + 1; checkC < (cIdx + cellValue.cw); checkC++) {
                const checkCol = getColumnNameForIndex(checkC);
                const checkColWidth = grid.colSizes[checkCol] || DEF_COL_WIDTH;

                cellWidth += Math.floor(checkColWidth * grid.scale);
            }

            isMerged = true;
        }

        if(cellValue.rh && cellValue.rh > 1) {
            for(let checkR = row + 1; checkR < (row + cellValue.rh); checkR++) {
                const checkRowHeight = grid.rowSizes[checkR] || DEF_ROW_HEIGHT;
                cellHeight += Math.floor(checkRowHeight * grid.scale);
            }

            isMerged = true;
        }

        if(isMerged) {
            grid.context.clearRect(cX + grid.scale, rY + grid.scale, cellWidth - (grid.scale * 2), cellHeight - (grid.scale * 2));
        }

        if(cellValue.bg && (cellValue.bg.trim().length == 7 || cellValue.bg.indexOf("rgb") == 0)) {
            grid.context.fillStyle = cellValue.bg;
            grid.context.fillRect(cX + grid.scale, rY + grid.scale, cellWidth - (grid.scale * 2), cellHeight - (grid.scale * 2));
        }

        if(cellValue.img) {
            if(!retainedImages[cellValue.img]) {
                const img = new Image();
                img.onload = function() {
                    grid.needsDraw = true;
                };
                img.src = cellValue.img;
                retainedImages[cellValue.img] = img;
            }

            const img = retainedImages[cellValue.img];

            if(img.complete) {
                const imgWidth = Math.floor(cellWidth - (grid.scale * 2));
                const imgHeight = Math.floor(cellHeight - (grid.scale * 2));

                grid.context.drawImage(img, cX + grid.scale, rY + grid.scale, imgWidth, imgHeight);
            }
        }

        // there might be other things in the cell 
        // like an image 
        if(cellValue.v) {
            let useText = cellValue.v;

            let textX = cX;

            if(cellValue.b && cellValue.b == 1) {
                grid.context.font = "bold " + (12 * grid.scale) + "px " + grid.defFont;
            } else {
                grid.context.font = (12 * grid.scale) + "px " + grid.defFont;
            }

            if(cellValue.c && cellValue.c.trim().length == 7) {
                grid.context.fillStyle = cellValue.c;
            } else {
                grid.context.fillStyle = defColor;
            }

            grid.context.textAlign = cellAlign;

            if(cellAlign == "right") {
                textX += cellWidth;
            }

            if(cellAlign == "center") {
                textX += Math.floor(cellWidth / 2);
            }
  
            if(cellValue.f && cellValue.f == CELL_FORMATS.CURRENCY) {
                if(useText) {
                    const formatter = new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: grid.currencyCode
                    });
                        
                    useText = formatter.format(useText);
                }
            }

            if(cellWidth > 0) {
                let finalLen = grid.context.measureText(useText).width;

                while(finalLen > cellWidth) {
                    useText = useText.toString().slice(0, -1);
                    finalLen = grid.context.measureText(useText).width;
                }

                const textY = Math.floor(rY + cellHeight);
                grid.context.textBaseline = "bottom";
                    
                grid.context.fillText(useText, textX, textY);
            }

                
        }
            
    }
}

globalRender();