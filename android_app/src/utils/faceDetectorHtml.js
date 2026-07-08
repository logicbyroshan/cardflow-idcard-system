// Auto-generated offline face detector (Canvas pixel analysis)
export const faceDetectorHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body{margin:0;padding:0;background:#000;}canvas{display:none;}</style>
</head>
<body>
  <canvas id="cv"></canvas>
  <script>
    var READY = false;

    function analyzeImage(base64) {
      var img = new Image();
      img.onload = function() {
        try {
          var canvas = document.getElementById('cv');
          // Scale down to 300px wide for speed
          var scale = 300 / img.width;
          canvas.width = 300;
          canvas.height = Math.round(img.height * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          var w = canvas.width;
          var h = canvas.height;
          var data = ctx.getImageData(0, 0, w, h).data;

          // ----- 1. FACE DETECTION via skin tone pixels in center region -----
          var cx1 = Math.floor(w * 0.20), cx2 = Math.floor(w * 0.80);
          var cy1 = Math.floor(h * 0.05), cy2 = Math.floor(h * 0.85);
          var skinPx = 0, totalPx = 0;
          for (var y = cy1; y < cy2; y++) {
            for (var x = cx1; x < cx2; x++) {
              var i = (y * w + x) * 4;
              var r = data[i], g = data[i+1], b = data[i+2];
              // Standard skin tone RGB heuristics (works for all skin tones)
              var maxRGB = Math.max(r,g,b), minRGB = Math.min(r,g,b);
              if (r > 60 && g > 30 && b > 15 && r > g && r > b &&
                  (maxRGB - minRGB) > 15 && r > 100) {
                skinPx++;
              }
              totalPx++;
            }
          }
          var skinRatio = skinPx / totalPx;
          var faceDetected = skinRatio > 0.06; // >=6% skin pixels = face present

          // ----- 2. EYES OPEN via dark-pixel density in eye zone -----
          // Eye region = middle horizontal band, top 25-45% of frame
          var ex1 = Math.floor(w * 0.25), ex2 = Math.floor(w * 0.75);
          var ey1 = Math.floor(h * 0.25), ey2 = Math.floor(h * 0.45);
          var darkPx = 0, eyePxTotal = 0, eyeBrightSum = 0;
          for (var y = ey1; y < ey2; y++) {
            for (var x = ex1; x < ex2; x++) {
              var i = (y * w + x) * 4;
              var gray = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
              eyeBrightSum += gray;
              if (gray < 55) darkPx++;
              eyePxTotal++;
            }
          }
          var darkRatio = darkPx / eyePxTotal;
          var avgEyeBright = eyeBrightSum / eyePxTotal;
          // Open eyes have visible dark pupils/iris - at least 1.5% very dark pixels
          var eyesOpen = darkRatio > 0.015;

          // ----- 3. SUNGLASSES via eye-zone vs forehead brightness ratio -----
          var fhY1 = Math.floor(h * 0.05), fhY2 = Math.floor(h * 0.22);
          var fhBrightSum = 0, fhCount = 0;
          for (var y = fhY1; y < fhY2; y++) {
            for (var x = ex1; x < ex2; x++) {
              var i = (y * w + x) * 4;
              fhBrightSum += 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
              fhCount++;
            }
          }
          var avgFhBright = fhBrightSum / fhCount;
          // Sunglasses: eye band is much darker than forehead AND very dark overall
          var sunglassRatio = avgEyeBright / Math.max(1, avgFhBright);
          var wearingSunglasses = sunglassRatio < 0.50 && avgEyeBright < 75;

          // ----- 4. OPTICAL GLASSES via Sobel edge density on nose-bridge area -----
          var nbX1 = Math.floor(w * 0.40), nbX2 = Math.floor(w * 0.60);
          var nbY1 = Math.floor(h * 0.38), nbY2 = Math.floor(h * 0.50);
          var edgePx = 0, edgeTotal = 0;
          for (var y = nbY1 + 1; y < nbY2 - 1; y++) {
            for (var x = nbX1 + 1; x < nbX2 - 1; x++) {
              var idx = function(yy, xx) {
                return (yy * w + xx) * 4;
              };
              var gx = (
                -1 * (0.299*data[idx(y-1,x-1)] + 0.587*data[idx(y-1,x-1)+1] + 0.114*data[idx(y-1,x-1)+2]) +
                 1 * (0.299*data[idx(y-1,x+1)] + 0.587*data[idx(y-1,x+1)+1] + 0.114*data[idx(y-1,x+1)+2]) +
                -2 * (0.299*data[idx(y,x-1)]   + 0.587*data[idx(y,x-1)+1]   + 0.114*data[idx(y,x-1)+2]) +
                 2 * (0.299*data[idx(y,x+1)]   + 0.587*data[idx(y,x+1)+1]   + 0.114*data[idx(y,x+1)+2]) +
                -1 * (0.299*data[idx(y+1,x-1)] + 0.587*data[idx(y+1,x-1)+1] + 0.114*data[idx(y+1,x-1)+2]) +
                 1 * (0.299*data[idx(y+1,x+1)] + 0.587*data[idx(y+1,x+1)+1] + 0.114*data[idx(y+1,x+1)+2])
              );
              if (Math.abs(gx) > 40) edgePx++;
              edgeTotal++;
            }
          }
          var edgeDensity = edgePx / Math.max(1, edgeTotal);
          var wearingGlasses = edgeDensity > 0.10;

          // Override: if sunglasses detected, eyes are not visible anyway
          if (wearingSunglasses) eyesOpen = false;

          var result = {
            face_detected: faceDetected,
            eyes_open: eyesOpen,
            wearing_sunglasses: wearingSunglasses,
            wearing_glasses: wearingGlasses,
            debug: {
              skinRatio: Math.round(skinRatio * 1000) / 10,
              darkRatio: Math.round(darkRatio * 1000) / 10,
              avgEyeBright: Math.round(avgEyeBright),
              avgFhBright: Math.round(avgFhBright),
              edgeDensity: Math.round(edgeDensity * 1000) / 10
            }
          };

          notifyRN(JSON.stringify(result));
        } catch(e) {
          notifyRN(JSON.stringify({ error: true, message: e.message }));
        }
      };
      img.onerror = function() {
        notifyRN(JSON.stringify({ error: true, message: 'Image failed to load' }));
      };
      img.src = 'data:image/jpeg;base64,' + base64;
    }

    function notifyRN(msg) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(msg);
      }
    }

    function handleMessage(event) {
      if (!event || !event.data) return;
      var data;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch(e) { return; }
      if (data && data.image) {
        analyzeImage(data.image);
      }
    }

    // Android uses document, iOS uses window — listen to both
    document.addEventListener('message', handleMessage);
    window.addEventListener('message', handleMessage);
  </script>
</body>
</html>`;
