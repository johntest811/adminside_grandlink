"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from "@/app/lib/activity";
import { createNotification } from "@/app/lib/notifications";
import * as THREE from "three";
import { FBXLoader, OrbitControls } from "three-stdlib";

const uploadFile = async (file: File, folder: string) => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${uuidv4()}.${fileExt}`;
  const { data, error } = await supabase.storage
    .from('products')
    .upload(`${folder}/${fileName}`, file);

  if (error) throw error;
  return supabase.storage.from('products').getPublicUrl(`${folder}/${fileName}`).data.publicUrl;
};

export default function ProductsAdminPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fullProductName, setFullProductName] = useState("");
  const [additionalFeatures, setAdditionalFeatures] = useState("");
  const [price, setPrice] = useState("");
  const [inventory, setInventory] = useState("0");
  const [images, setImages] = useState<File[]>([]);
  const [fbxFiles, setFbxFiles] = useState<File[]>([]);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [category, setCategory] = useState("");
  const [height, setHeight] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [material, setMaterial] = useState("Glass");
  const [type, setType] = useState("Tinted");
  const [showPopup, setShowPopup] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);

  // Show popup for 3 seconds when product is added
  useEffect(() => {
    if (message && message.includes("successfully")) {
      setShowPopup(true);
      const timer = setTimeout(() => setShowPopup(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Load current admin
  useEffect(() => {
    const loadAdmin = async () => {
      try {
        console.log("🔍 Loading current admin...");
        
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          setCurrentAdmin(admin);
          console.log("✅ Admin loaded:", admin);
          
          try {
            await logActivity({
              admin_id: admin.id,
              admin_name: admin.username,
              action: 'view',
              entity_type: 'page',
              details: `Accessed Add Products page`,
              page: 'products',
              metadata: {
                pageAccess: true,
                adminAccount: admin.username,
                timestamp: new Date().toISOString()
              }
            });
          } catch (activityError) {
            console.error("Failed to log activity:", activityError);
          }
          return;
        }
        
        const { data: sessionUser } = await supabase.auth.getUser();
        if (!sessionUser?.user?.id) {
          console.warn("⚠️ No user session found");
          const defaultAdmin = {
            id: 'admin-default',
            username: 'Admin User',
            role: 'admin'
          };
          setCurrentAdmin(defaultAdmin);
          localStorage.setItem('adminSession', JSON.stringify(defaultAdmin));
          return;
        }
        
        const userId = sessionUser.user.id;
        const { data: adminRows } = await supabase
          .from("admins")
          .select("*")
          .eq("id", userId);
        
        if (!adminRows || adminRows.length === 0) {
          const { data: newAdmin, error: createError } = await supabase
            .from("admins")
            .insert({
              id: userId,
              username: sessionUser.user.email?.split('@')[0] || 'Admin',
              role: 'admin',
              position: 'Admin',
              created_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (!createError && newAdmin) {
            setCurrentAdmin(newAdmin);
            console.log("✅ Created and loaded new admin:", newAdmin);
          }
        } else {
          const admin = adminRows[0];
          setCurrentAdmin(admin);
          console.log("✅ Admin loaded from database:", admin);
        }
        
      } catch (e) {
        console.error("💥 Load admin exception:", e);
        const fallbackAdmin = {
          id: 'admin-fallback',
          username: 'Admin User',
          role: 'admin'
        };
        setCurrentAdmin(fallbackAdmin);
      }
    };

    loadAdmin();
  }, []);

  // FBX Viewer component
  function FBXViewer({ file }: { file: File }) {
    useEffect(() => {
      let loader: any;
      let model: THREE.Group | undefined;
      let controls: any;
      let renderer: THREE.WebGLRenderer;
      let scene: THREE.Scene;
      let camera: THREE.PerspectiveCamera;
      let animationId: number;
      let onResizeHandler: (() => void) | null = null;

      async function loadFBX() {
        const { FBXLoader } = await import('three-stdlib');
        const { OrbitControls } = await import('three-stdlib');
        loader = new FBXLoader();

        scene = new THREE.Scene();
        scene.background = null;
        
  // Determine dynamic size based on container
  const mountEl = document.getElementById('fbx-canvas');
  const mountWidth = mountEl?.clientWidth || 1000;
  const mountHeight = mountEl?.clientHeight || 600;
  camera = new THREE.PerspectiveCamera(75, mountWidth / mountHeight, 0.1, 1000);
        camera.position.set(0, 50, 100);

        renderer = new THREE.WebGLRenderer({ 
          antialias: true, 
          alpha: true,
          powerPreference: "high-performance"
        });
        renderer.setClearColor(0x000000, 0);
  renderer.setSize(mountWidth, mountHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        scene.add(directionalLight);

        const rimLight1 = new THREE.DirectionalLight(0x88ccff, 0.5);
        rimLight1.position.set(-10, 5, -5);
        scene.add(rimLight1);

        const rimLight2 = new THREE.DirectionalLight(0xffaa88, 0.3);
        rimLight2.position.set(5, -5, 10);
        scene.add(rimLight2);

        const pointLight = new THREE.PointLight(0xffffff, 0.8, 100);
        pointLight.position.set(0, 20, 20);
        scene.add(pointLight);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.autoRotate = false;
        controls.minDistance = 10;
        controls.maxDistance = 500;

        const objectUrl = URL.createObjectURL(file);
        
        loader.load(
          objectUrl,
          (object: THREE.Group) => {
            model = object;
            
            object.traverse((child: any) => {
              if (child.isMesh) {
                const material = child.material;
                if (Array.isArray(material)) {
                  material.forEach((mat, index) => {
                    child.material[index] = processGlassMaterial(mat);
                  });
                } else {
                  child.material = processGlassMaterial(material);
                }
                
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });
            
            const box = new THREE.Box3().setFromObject(object);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            object.position.sub(center);
            
            const maxSize = Math.max(size.x, size.y, size.z);
            if (maxSize > 0) {
              const scale = 80 / maxSize;
              object.scale.setScalar(scale);
            }
            
            const distance = Math.max(size.x, size.y, size.z) * 1.5;
            camera.position.set(distance, distance * 0.5, distance);
            camera.lookAt(0, 0, 0);
            
            controls.target.set(0, 0, 0);
            controls.update();
            
            scene.add(model);
            URL.revokeObjectURL(objectUrl);
          },
          undefined,
          (error: unknown) => {
            console.error('Error loading FBX:', error);
            URL.revokeObjectURL(objectUrl);
          }
        );

        const mount = document.getElementById('fbx-canvas');
        if (mount) {
          mount.innerHTML = '';
          mount.appendChild(renderer.domElement);
        }

        // Handle resize
        function onResize() {
          const w = mount?.clientWidth || mountWidth;
          const h = mount?.clientHeight || mountHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
        onResizeHandler = onResize;
        window.addEventListener('resize', onResizeHandler);

        function animate() {
          animationId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        }
        animate();
      }

      function processGlassMaterial(material: any): THREE.Material {
        if (!material) return material;
        
        const materialName = (material.name || '').toLowerCase();
        const isGlass = materialName.includes('glass') || 
                       materialName.includes('transparent') || 
                       materialName.includes('window') ||
                       materialName.includes('crystal') ||
                       material.transparent === true ||
                       (material.opacity !== undefined && material.opacity < 0.9);
        
        if (isGlass) {
          const glassMaterial = new THREE.MeshPhysicalMaterial({
            color: material.color || new THREE.Color(0xffffff),
            transmission: 0.95,
            opacity: 0.1,
            metalness: 0.0,
            roughness: 0.05,
            ior: 1.52,
            thickness: 0.5,
            transparent: true,
            side: THREE.DoubleSide,
            clearcoat: 1.0,
            clearcoatRoughness: 0.0,
            reflectivity: 0.9,
            envMapIntensity: 1.0,
          });
          
          if (material.map) glassMaterial.map = material.map;
          if (material.normalMap) glassMaterial.normalMap = material.normalMap;
          if (material.roughnessMap) glassMaterial.roughnessMap = material.roughnessMap;
          
          return glassMaterial;
        } else {
          if (material.type === 'MeshBasicMaterial') {
            const newMaterial = new THREE.MeshStandardMaterial({
              color: material.color,
              map: material.map,
              transparent: material.transparent,
              opacity: material.opacity,
              roughness: 0.7,
              metalness: 0.1,
            });
            return newMaterial;
          } else {
            material.roughness = material.roughness || 0.7;
            material.metalness = material.metalness || 0.1;
          }
        }
        
        material.needsUpdate = true;
        return material;
      }

      loadFBX();

      return () => {
        const mount = document.getElementById('fbx-canvas');
        if (mount) mount.innerHTML = '';
        
        if (animationId) {
          cancelAnimationFrame(animationId);
        }
        
        if (onResizeHandler) {
          window.removeEventListener('resize', onResizeHandler);
        }
        if (renderer) {
          renderer.dispose();
          renderer.forceContextLoss();
        }
        if (controls) controls.dispose();
        if (model) {
          scene.remove(model);
          model.traverse((child: any) => {
            if (child.isMesh) {
              child.geometry?.dispose();
              if (Array.isArray(child.material)) {
                child.material.forEach((mat: any) => mat.dispose());
              } else {
                child.material?.dispose();
              }
            }
          });
        }
      };
    }, [file]);

    return (
      <div
        id="fbx-canvas"
        style={{
          width: '100%',
          height: '100%',
          background: 'transparent',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      />
    );
  }

  const handleSingleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Allow unlimited images by appending without slicing
    const newImages = [...images, ...files];
    setImages(newImages);
    setCarouselIndex(0);
    
    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: 'product_images',
          details: `Added ${files.length} product image(s). Total: ${newImages.length}`,
          page: 'products',
          metadata: {
            addedCount: files.length,
            totalCount: newImages.length,
            fileNames: files.map(f => f.name),
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log image upload:", error);
      }
    }
  };

  const removeImage = async (index: number) => {
    const removedImage = images[index];
    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);
    
    if (carouselIndex >= newImages.length && newImages.length > 0) {
      setCarouselIndex(Math.max(0, newImages.length - 3));
    }
    
    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'delete',
          entity_type: 'product_image',
          details: `Removed product image: ${removedImage.name}`,
          page: 'products',
          metadata: {
            fileName: removedImage.name,
            removedIndex: index + 1,
            remainingCount: newImages.length,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log image removal:", error);
      }
    }
  };

  const handleSingleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const newFbxFiles = [...fbxFiles, ...files];
    setFbxFiles(newFbxFiles);

    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: 'fbx_files',
          details: `Added ${files.length} FBX file(s). Total: ${newFbxFiles.length}`,
          page: 'products',
          metadata: {
            addedCount: files.length,
            totalCount: newFbxFiles.length,
            fileNames: files.map(f => f.name),
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log FBX upload:", error);
      }
    }
  };

  const removeFbxFile = async (index: number) => {
    const removedFile = fbxFiles[index];
    setFbxFiles(prev => prev.filter((_, i) => i !== index));
    
    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'delete',
          entity_type: 'fbx_file',
          details: `Removed FBX file: ${removedFile.name}`,
          page: 'products',
          metadata: {
            fileName: removedFile.name,
            removedIndex: index + 1,
            remainingCount: fbxFiles.length - 1,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log FBX removal:", error);
      }
    }
  };

  const handleOpen3DViewer = async (index: number = 0) => {
    if (fbxFiles.length > 0 && index < fbxFiles.length) {
      setCurrentFbxIndex(index);
      setShow3DViewer(true);
      
      if (currentAdmin) {
        try {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: '3d_model',
            details: `Opened 3D FBX viewer for file: ${fbxFiles[index].name} (${index + 1}/${fbxFiles.length})`,
            page: 'products',
            metadata: {
              fileName: fbxFiles[index].name,
              fileSize: fbxFiles[index].size,
              fileType: 'fbx',
              fileIndex: index + 1,
              totalFiles: fbxFiles.length,
              adminAccount: currentAdmin.username
            }
          });
        } catch (error) {
          console.error("Failed to log 3D viewer usage:", error);
        }
      }
    }
  };

  // Enhanced product creation with API call for notifications
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    
    try {
      console.log("🚀 Starting product creation...");
      
      if (!currentAdmin) {
        throw new Error("Admin information not available. Please refresh the page.");
      }
      
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'create',
          entity_type: 'product_form_submission',
          details: `Initiated product creation for "${name}" in category "${category}"`,
          page: 'products',
          metadata: {
            productName: name,
            category,
            price: Number(price) || 0,
            inventory: Number(inventory) || 0,
            hasImages: images.length > 0,
            hasFbx: fbxFiles.length > 0,
            fbxCount: fbxFiles.length,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log form submission:", error);
      }
      
      // Upload images (unlimited)
      const imageUrls: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          const url = await uploadFile(img, 'images');
          imageUrls.push(url);
          console.log(`✅ Image ${i + 1} uploaded:`, url);
        } catch (uploadError) {
          console.error(`Failed to upload image ${i + 1}:`, uploadError);
        }
      }

      // Upload FBX files
      const fbxUploadedUrls: string[] = [];
      for (let i = 0; i < fbxFiles.length; i++) {
        const file = fbxFiles[i];
        try {
          const url = await uploadFile(file, 'fbx');
          fbxUploadedUrls.push(url);
          console.log(`✅ FBX ${i + 1} uploaded:`, url);
        } catch (uploadError) {
          console.error(`Failed to upload FBX ${i + 1}:`, uploadError);
        }
      }

      console.log("📦 Creating product in database...");

      // Prepare the product data
      const productData: any = {
        name: name.trim(),
        fullproductname: fullProductName.trim() || null,
        additionalfeatures: additionalFeatures.trim() || null,
        description: description.trim() || null,
        price: Number(price) || 0,
        inventory: Number(inventory) || 0,
        category: category.trim(),
        height: height ? Number(height) : null,
        width: width ? Number(width) : null,
        thickness: thickness ? Number(thickness) : null,
        material: material || 'Glass',
        type: type || 'Tinted',
        images: imageUrls,
        fbx_url: fbxUploadedUrls.length > 0 ? fbxUploadedUrls[0] : null,
        fbx_urls: fbxUploadedUrls.length > 0 ? fbxUploadedUrls : null
      };

      // Backward-compat: keep legacy image1..image5 fields populated
      productData.image1 = imageUrls[0] || null;
      productData.image2 = imageUrls[1] || null;
      productData.image3 = imageUrls[2] || null;
      productData.image4 = imageUrls[3] || null;
      productData.image5 = imageUrls[4] || null;

      // OLD (remove):
      // const { data: insertedProduct, error: insertError } = await supabase
      //   .from('products')
      //   .insert(productData)
      //   .select()
      //   .single();
      // if (insertError) throw new Error(insertError.message);

      // NEW: call server API (uses service role)
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // pass admin info for logging (your API already reads this)
          authorization: JSON.stringify(currentAdmin || {})
        },
        body: JSON.stringify(productData),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to create product');
      const insertedProduct = json.product;

      console.log("✅ Product created successfully:", insertedProduct);

      // Create admin notification
      try {
        await createNotification({
          title: "New Product Added",
          message: `Product "${insertedProduct.name}" has been successfully added to the inventory.`,
          type: "stock",
          priority: "medium",
          recipient_role: "admin"
        });
        console.log("✅ Admin notification created");
      } catch (notifError) {
        console.error("⚠️ Failed to create admin notification:", notifError);
      }

      // Send notifications to users via API route
      console.log("📢 Sending user notifications via API...");
      
      try {
        const notificationResponse = await fetch('/api/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'new_product',
            productName: insertedProduct.name,
            productId: insertedProduct.id,
            adminName: currentAdmin.username
          }),
        });

        const notificationResult = await notificationResponse.json();

        if (notificationResponse.ok && notificationResult.success) {
          console.log("✅ User notifications sent:", notificationResult.message);
          setMessage(`Product "${insertedProduct.name}" added successfully! ${notificationResult.message}`);
        } else {
          console.error("❌ User notification error:", notificationResult.error);
          setMessage(`Product "${insertedProduct.name}" added successfully! (Note: User notifications may have failed)`);
        }
      } catch (notificationError) {
        console.error("❌ Failed to send notifications:", notificationError);
        setMessage(`Product "${insertedProduct.name}" added successfully! (Note: User notifications failed)`);
      }
      
      // Reset form
      setName("");
      setFullProductName("");
      setDescription("");
      setAdditionalFeatures("");
      setPrice("");
      setInventory("0");
      setImages([]);
      setFbxFiles([]);
      setHeight("");
      setWidth("");
      setThickness("");
      setMaterial("Glass");
      setType("Tinted");
      setCategory("");
      setCarouselIndex(0);
      
    } catch (err: any) {
      console.error("💥 Product creation failed:", err);
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getCarouselImages = () => {
    if (images.length <= 3) return images;
    if (carouselIndex + 3 <= images.length) {
      return images.slice(carouselIndex, carouselIndex + 3);
    }
    return [
      ...images.slice(carouselIndex),
      ...images.slice(0, 3 - (images.length - carouselIndex))
    ];
  };

  const handlePrev = () =>
    setCarouselIndex((i) =>
      i === 0 ? Math.max(images.length - 3, 0) : i - 1
    );
  const handleNext = () =>
    setCarouselIndex((i) =>
      i + 3 >= images.length ? 0 : i + 1
    );

  return (
    <div className="min-h-screen bg-[#e7eaef] flex items-center justify-center">
      <div className="max-w-5xl w-full p-8 rounded-lg shadow-lg bg-white/80 flex flex-col space-y-6">
        {/* Title */}
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-[#505A89] mb-2 tracking-tight">ADD PRODUCTS</h1>
          <div className="text-sm text-gray-600">
            {currentAdmin ? (
              <span className="text-green-600">✅ Admin: {currentAdmin.username || currentAdmin.id}</span>
            ) : (
              <span className="text-yellow-600">⏳ Loading admin...</span>
            )}
          </div>
        </div>

        {/* Success Popup */}
        {showPopup && (
          <div className="fixed top-8 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded shadow-lg z-50 transition-opacity duration-300">
            Product added successfully! User notifications sent.
          </div>
        )}

        {/* 3D Viewer Modal */}
        {show3DViewer && fbxFiles.length > 0 && (
          <div className="fixed inset-0 flex items-center justify-center z-50 bg-transparent">
            <div className="bg-white/95 backdrop-blur-md rounded-xl p-6 shadow-2xl relative max-w-7xl w-[95vw] h-[85vh] mx-4">
              <button
                onClick={() => setShow3DViewer(false)}
                className="absolute top-3 right-3 text-gray-700 hover:text-black text-2xl font-bold z-10 bg-white rounded-full w-10 h-10 flex items-center justify-center shadow-md"
              >
                ×
              </button>
              
              <div className="mb-4">
                <h2 className="text-lg font-bold text-[#233a5e] mb-2">3D FBX Viewer</h2>
                <div className="text-sm text-gray-600 mb-2">
                  Viewing: {fbxFiles[currentFbxIndex]?.name} ({currentFbxIndex + 1} of {fbxFiles.length})
                </div>
                
                {fbxFiles.length > 1 && (
                  <div className="flex justify-center items-center gap-4 mb-4">
                    <button
                      onClick={() => setCurrentFbxIndex(Math.max(0, currentFbxIndex - 1))}
                      disabled={currentFbxIndex === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
                    >
                      ← Previous
                    </button>
                    
                    <div className="flex space-x-1">
                      {fbxFiles.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentFbxIndex(index)}
                          className={`w-8 h-8 rounded-full text-xs font-bold transition-colors ${
                            index === currentFbxIndex 
                              ? 'bg-blue-600 text-white' 
                              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                          }`}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                    
                    <button
                      onClick={() => setCurrentFbxIndex(Math.min(fbxFiles.length - 1, currentFbxIndex + 1))}
                      disabled={currentFbxIndex === fbxFiles.length - 1}
                      className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
                    >
                      Next →
                    </button>
                  </div>
                )}
                
                <div className="text-xs text-gray-500 mb-2">Use mouse to rotate, zoom, and pan. Background is transparent for clean previews.</div>
              </div>
              <div className="h-[70vh]">
                <FBXViewer file={fbxFiles[currentFbxIndex]} />
              </div>
            </div>
          </div>
        )}
        
        <form onSubmit={handleAddProduct}>
          <div className="grid grid-cols-2 gap-6">
            {/* Product Name and Description */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Product Name and Description</h2>
              <label className="block text-[#233a5e] font-semibold mb-1">Product Name</label>
              <input
                type="text"
                placeholder="Product Name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                required
              />

              <div className="mt-2">
                <label className="block text-[#233a5e] font-semibold mb-1">Full Product Name</label>
                <input
                  type="text"
                  placeholder="Full Product Name"
                  value={fullProductName}
                  onChange={e => setFullProductName(e.target.value)}
                  className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                />
              </div>

              <label className="block text-[#233a5e] font-semibold mb-1">Product Description</label>
              <textarea
                placeholder="Product Description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black"
              />

              <div className="mt-4">
                <label className="block text-[#233a5e] font-semibold mb-1">Additional Features</label>
                <textarea
                  placeholder="One feature per line or free text"
                  value={additionalFeatures}
                  onChange={e => setAdditionalFeatures(e.target.value)}
                  className="w-full border border-gray-300 p-2 rounded bg-white text-black"
                  rows={3}
                />
              </div>
            </div>

            {/* Product Details */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Product Details</h2>
              <label className="block text-[#233a5e] font-semibold mb-1">Price (PHP)</label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                placeholder="0.00"
                required
                min="0"
              />
              <label className="block text-[#233a5e] font-semibold mb-1">Inventory</label>
              <input
                type="number"
                value={inventory}
                onChange={e => setInventory(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                placeholder="0"
                min="0"
              />
              <div className="flex space-x-4 mb-4">
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Height:</label>
                  <input
                    type="number"
                    value={height}
                    onChange={e => setHeight(e.target.value)}
                    className="w-20 border border-gray-300 p-1 rounded bg-white text-black"
                  />
                </div>
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Width:</label>
                  <input
                    type="number"
                    value={width}
                    onChange={e => setWidth(e.target.value)}
                    className="w-20 border border-gray-300 p-1 rounded bg-white text-black"
                  />
                </div>
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Thickness:</label>
                  <input
                    type="number"
                    value={thickness}
                    onChange={e => setThickness(e.target.value)}
                    className="w-20 border border-gray-300 p-1 rounded bg-white text-black"
                  />
                </div>
              </div>
              <div className="flex space-x-4">
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Material:</label>
                  <select
                    className="border border-gray-300 p-1 rounded bg-white text-black"
                    value={material}
                    onChange={e => setMaterial(e.target.value)}
                  >
                    <option value="Glass">Glass</option>
                    <option value="Wood">Wood</option>
                    <option value="Metal">Metal</option>
                    <option value="Aluminum">Aluminum</option>
                    <option value="Steel">Steel</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Type:</label>
                  <select
                    className="border border-gray-300 p-1 rounded bg-white text-black"
                    value={type}
                    onChange={e => setType(e.target.value)}
                  >
                    <option value="Tinted">Tinted</option>
                    <option value="Clear">Clear</option>
                    <option value="Frosted">Frosted</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Category */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Category</h2>
              <label className="block text-[#233a5e] font-semibold mb-1">Product Category</label>
              <div className="relative">
                <select
                  className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4 appearance-none"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  required
                  style={{ position: "relative", zIndex: 10 }}
                >
                  <option value="">Select Category</option>
                  <option value="Doors">Doors</option>
                  <option value="Windows">Windows</option>
                  <option value="Enclosures">Enclosures</option>
                  <option value="Casement">Casement</option>
                  <option value="Sliding">Sliding</option>
                  <option value="Railings">Railings</option>
                  <option value="Canopy">Canopy</option>
                  <option value="Curtain Wall">Curtain Wall</option>
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  ▼
                </span>
              </div>
            </div>

            {/* Product Files Section */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Product Files</h2>
              
              {/* Images Upload (Unlimited) */}
              <div className="mb-6">
                <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                  Product Images ({images.length})
                </h3>
                
                <div className="flex items-center space-x-2 mb-4">
                  <label
                    htmlFor="images-upload"
                    className={
                      'flex flex-col items-center justify-center w-28 h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors border-gray-400 bg-[#e7eaef] hover:bg-gray-200'
                    }
                  >
                    <span className="text-2xl">+</span>
                    <span className="text-xs text-[#233a5e]">Add Image</span>
                    <span className="text-[10px] text-gray-500 mt-1">Unlimited</span>
                  </label>
                  <input
                    id="images-upload"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleSingleImageUpload}
                    className="hidden"
                  />
                  
                  {images.length > 0 && (
                    <div className="flex items-center space-x-2 flex-wrap">
                      {getCarouselImages().map((img, idx) => {
                        const actualIndex = carouselIndex + idx;
                        return (
                          <div key={actualIndex} className="relative">
                            <img
                              src={URL.createObjectURL(img)}
                              alt={`Product Image ${actualIndex + 1}`}
                              className="w-20 h-20 object-cover rounded-lg border border-gray-300"
                            />
                            <button
                              type="button"
                              onClick={() => removeImage(actualIndex)}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {images.length > 3 && (
                  <div className="flex justify-center space-x-2 mb-2">
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      ←
                    </button>
                    <span className="text-sm text-gray-600 px-2 py-1">
                      {Math.floor(carouselIndex / 3) + 1} / {Math.ceil(images.length / 3)}
                    </span>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      →
                    </button>
                  </div>
                )}
              </div>

              {/* FBX Files Upload */}
              <div className="mb-4">
                <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                  3D FBX Models ({fbxFiles.length} files)
                </h3>
                
                <label
                  htmlFor="fbx-upload"
                  className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-gray-400 rounded-lg cursor-pointer bg-[#e7eaef] hover:bg-gray-200 mb-2"
                >
                  <span className="text-sm text-[#233a5e]">+ Add FBX Files</span>
                </label>
                <input
                  id="fbx-upload"
                  type="file"
                  accept=".fbx"
                  multiple
                  onChange={handleSingleFbxUpload}
                  className="hidden"
                />
                
                {fbxFiles.length > 0 && (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {fbxFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-gray-100 rounded text-xs border">
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium text-[#233a5e]" title={file.name}>
                            {file.name}
                          </div>
                          <div className="text-gray-500">
                            {(file.size / (1024 * 1024)).toFixed(2)} MB
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 ml-2">
                          <button
                            type="button"
                            onClick={() => handleOpen3DViewer(index)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                          >
                            View 3D
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFbxFile(index)}
                            className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`w-full px-4 py-2 rounded font-semibold transition-colors ${
                  fbxFiles.length > 0 
                    ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                disabled={fbxFiles.length === 0}
                onClick={() => handleOpen3DViewer(0)}
              >
                {fbxFiles.length === 0 
                  ? 'No FBX Files' 
                  : `Open 3D Viewer (${fbxFiles.length} ${fbxFiles.length === 1 ? 'model' : 'models'})`
                }
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className={`flex items-center justify-center gap-2 px-6 py-2 rounded font-semibold transition-colors duration-200 ${
                loading ? "bg-blue-600 opacity-70 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-800"
              } text-white`}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Adding Product...
                </>
              ) : (
                "Add Product & Notify Users"
              )}
            </button>
          </div>

          {/* Message */}
          {message && (
            <div className={`mt-4 p-3 rounded ${
              message.includes('Error') 
                ? 'bg-red-100 border border-red-400 text-red-700'
                : 'bg-green-100 border border-green-400 text-green-700'
            }`}>
              {message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}