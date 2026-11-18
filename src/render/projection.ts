/** WGSL mirrors sim/camera.ts. Coordinates refer to native sensor pixel edges.
 * WGS84 intersections operate in equatorial-radius units to avoid squared-meter cancellation. */
export const cameraRayWGSL = /* wgsl */ `
fn cameraRay(pixel: vec2f, sensor: vec3f, lens: vec4f, edgeFactor: f32) -> vec4f {
 let xy = (pixel - sensor.xy * 0.5) * sensor.z;
 let radius = length(xy);
 var theta = atan(radius / lens.x);
 if (lens.y > 0.5 && lens.y < 1.5) {
   theta = radius / lens.x;
   if (edgeFactor != 0.0) {
     let normalizedRadius = theta / lens.z;
     let edgeRadius = 1.0 + edgeFactor;
     var t = normalizedRadius / edgeRadius;
     if (normalizedRadius >= edgeRadius) {
       t = 1.0 + (normalizedRadius - edgeRadius) / (1.0 + 3.0 * edgeFactor);
     } else {
       for (var iteration = 0; iteration < 5; iteration++) {
         let cubic = edgeFactor * t * t;
         t -= (t * (1.0 + cubic) - normalizedRadius) / (1.0 + 3.0 * cubic);
       }
     }
     theta = t * lens.z;
   }
 }
 if (lens.y > 1.5) { theta = 2.0 * asin(min(1.0, radius / (2.0 * lens.x))); }
 let valid = radius <= lens.w * 0.5 && theta <= lens.z && theta <= 3.14159265 && !(lens.y > 1.5 && radius > 2.0*lens.x);
 let direction = vec3f(xy * sin(theta) / max(radius, 0.00000001), cos(theta));
 return vec4f(select(vec3f(0,0,1), direction, radius > 0.00000001), select(0.0,1.0,valid));
}`;
/** xyz is in equatorial-radius units. w is the hit distance in meters, zero
 * for a miss. Sky rays return the scaled closest point projected to the
 * ellipsoid so UV derivatives stay continuous across the limb. */
export const earthHitWGSL = /* wgsl */ `
fn earthHit(origin: vec3f, direction: vec3f, c: f32) -> vec4f {
 let radii = vec3f(1.0,1.0,0.9966471893352525);
 let o = origin / 6378137.0 / radii;
 let d = direction / radii;
 let a = dot(d,d); let b = dot(o,d);
 let discriminant = b*b-a*c;
 if (discriminant < 0.0 || b >= 0.0) {
   let closest = o + d * max(0.0, -b/a);
   return vec4f(normalize(closest) * radii, 0.0);
 }
 let t = c/(-b+sqrt(discriminant));
 return vec4f(origin / 6378137.0 + direction*t, t*6378137.0);
}`;
export const surfaceUVWgsl = /* wgsl */ `
fn surfaceUV(point: vec3f) -> vec4f {
 let lon = atan2(point.y,point.x);
 let lat = atan2(point.z / (0.9966471893352525*0.9966471893352525),length(point.xy));
 return vec4f(lon / 6.28318530718 + 0.5, lat / 3.14159265359 + 0.5, lon*6378137.0, log(tan(0.785398163397 + clamp(lat,-1.48442223,1.48442223)*0.5))*6378137.0);
}`;
export const projectedPixelWGSL = /* wgsl */ `
fn projectedPixel(ray: vec3f,sensor:vec3f,lens:vec4f,edgeFactor:f32)->vec3f {
 let theta = acos(clamp(ray.z,-1.0,1.0));
 var r=lens.x*tan(theta);
 if(lens.y > 0.5 && lens.y < 1.5){
   r = lens.x * theta;
   if (edgeFactor != 0.0) {
     let t = theta / lens.z;
     let normalizedRadius = select(1.0 + edgeFactor + (t - 1.0) * (1.0 + 3.0 * edgeFactor),
       t * (1.0 + edgeFactor * t * t), t <= 1.0);
     r = lens.x * lens.z * normalizedRadius;
   }
 }
 if(lens.y > 1.5){ r=2.0*lens.x*sin(theta*0.5); }
 let xy=ray.xy/max(length(ray.xy),0.00000001)*r/sensor.z+sensor.xy*0.5;
 let valid=theta<=lens.z && r<=lens.w*0.5 && all(xy>=vec2f(0.0)) && all(xy<=sensor.xy) && !(lens.y<0.5 && ray.z<=0.0);
 return vec3f(xy/sensor.xy,select(0.0,1.0,valid));
}`;

/** Regional UVs use ECEF deltas from the mosaic center. Evaluating absolute
 * EPSG:3857 eastings in float32 would lose meters before subtracting bounds.
 * Mercator difference uses atanh's odd series; its omitted term is <0.1 mm
 * for |argument|<=0.1 (well beyond a typical regional mosaic footprint). */
export const localMercatorWGSL = /* wgsl */ `
fn localMercator(delta:vec3f, reference:vec3f, latSinCos:vec2f)->vec2f {
 let radius=length(reference.xy);
 let rhoDelta=(2.0*dot(reference.xy,delta.xy)+dot(delta.xy,delta.xy))/(length(reference.xy+delta.xy)+radius);
 let lonDelta=atan2(reference.x*delta.y-reference.y*delta.x,radius*radius+dot(reference.xy,delta.xy));
 let e2=0.9933056200098587;
 let latDelta=atan2(e2*(radius*delta.z-reference.z*rhoDelta),e2*e2*radius*(radius+rhoDelta)+reference.z*(reference.z+delta.z));
 let sinHalfLatDelta=sin(latDelta*0.5);
 let sinDelta=latSinCos.x*(-2.0*sinHalfLatDelta*sinHalfLatDelta)+latSinCos.y*sin(latDelta);
 let x=clamp(sinDelta/(latSinCos.y*latSinCos.y-latSinCos.x*sinDelta),-0.99,0.99);
 let x2=x*x;
 let mercatorDelta=x*(1.0+x2*(1.0/3.0+x2*(1.0/5.0+x2*(1.0/7.0+x2/9.0))));
 return vec2f(lonDelta,mercatorDelta)*6378137.0;
}`;
