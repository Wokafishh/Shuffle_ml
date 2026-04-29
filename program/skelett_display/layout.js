// layout.js — computes the letterbox/pillarbox areas around the video

export function getLayout(video) {
    const viewerEl  = document.getElementById('viewer');
    const viewerRect = viewerEl.getBoundingClientRect();
    const videoRect  = video.getBoundingClientRect();

    const vw = video.videoWidth  || 1;
    const vh = video.videoHeight || 1;
    const isPortrait = vh > vw;

    // Video rect in overlay-canvas coordinates
    const videoArea = {
        x: videoRect.left - viewerRect.left,
        y: videoRect.top  - viewerRect.top,
        w: videoRect.width,
        h: videoRect.height,
    };

    const W = viewerRect.width;
    const H = viewerRect.height;

    let ballArea, skelArea;

    // Adjust this value to move the ball area up (negative moves it up)
    const yOffset = -80; 

    if (isPortrait) {
        // Black pillars left and right
        ballArea = { 
            x: 0, 
            y: yOffset, // Shifted up
            w: videoArea.x, 
            h: H 
        };
        skelArea = { x: videoArea.x + videoArea.w, y: 0, w: W - videoArea.x - videoArea.w, h: H };
    } else {
        // Black bars top and bottom
        // Reducing the height (h) or shifting y makes the "top bar" area appear higher/smaller
        ballArea = { 
            x: 0, 
            y: yOffset, 
            w: W, 
            h: videoArea.y + yOffset // Keeps the bottom edge relative to the video
        };
        skelArea = { x: 0, y: videoArea.y + videoArea.h, w: W, h: H - videoArea.y - videoArea.h };
    }

    return { isPortrait, videoArea, ballArea, skelArea, vw, vh };
}