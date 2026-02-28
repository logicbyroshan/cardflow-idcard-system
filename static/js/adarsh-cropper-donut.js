/**
 * Adarsh Cropper — Donut Chart Renderer
 * ───────────────────────────────────────
 * Pure canvas-based donut chart.  No external chart library.
 * Must be loaded BEFORE adarsh-cropper.js.
 *
 * @module adarsh-cropper-donut
 */

window.CropperDonut = {

  /**
   * Draw a donut chart on the given <canvas> element.
   *
   * @param {HTMLCanvasElement} canvas  - The canvas to draw on.
   * @param {number}            success - Count of successful items (green).
   * @param {number}            failed  - Count of failed items (red).
   */
  draw: function (canvas, success, failed) {
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var cx = W / 2;
    var cy = H / 2;
    var outerR = Math.min(cx, cy) - 4;
    var innerR = outerR * 0.62;  // donut hole

    ctx.clearRect(0, 0, W, H);

    var total = success + failed;
    if (total === 0) return;

    var slices = [
      { value: success, color: '#22c55e' },  // green
      { value: failed,  color: '#ef4444' },  // red
    ];

    var startAngle = -Math.PI / 2;  // 12 o'clock

    slices.forEach(function (slice) {
      if (slice.value === 0) return;
      var sweep = (slice.value / total) * 2 * Math.PI;
      var endAngle = startAngle + sweep;

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();

      startAngle = endAngle;
    });

    // Draw count labels on the slices
    startAngle = -Math.PI / 2;
    var midR = (outerR + innerR) / 2;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';

    slices.forEach(function (slice) {
      if (slice.value === 0) return;
      var sweep = (slice.value / total) * 2 * Math.PI;
      var midAngle = startAngle + sweep / 2;
      var lx = cx + midR * Math.cos(midAngle);
      var ly = cy + midR * Math.sin(midAngle);
      // Only draw label if slice is big enough
      if (sweep > 0.3) {
        ctx.fillText(String(slice.value), lx, ly);
      }
      startAngle += sweep;
    });
  },
};
