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
              // Standard skin tone RGB heuristics
              var maxRGB = Math.max(r,g,b), minRGB = Math.min(r,g,b);
              if (r > 60 && g > 30 && b > 15 && r > g && r > b &&
                  (maxRGB - minRGB) > 15 && r > 100) {
                skinPx++;
              }
              totalPx++;
            }
          }
          var skinRatio = skinPx / totalPx;
          // >=5.5% skin pixels = face present
          var faceDetected = skinRatio >= 0.055;
          // if face detected but skin ratio under 13%, person is too far from camera
          var tooFar = faceDetected && (skinRatio < 0.13);

          var result = {
            face_detected: faceDetected,
            too_far: tooFar,
            debug: {
              skinRatio: Math.round(skinRatio * 1000) / 10
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
