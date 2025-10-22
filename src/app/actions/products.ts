'use server'

import { createAdminClient } from '@/app/Clients/Supabase/SupabaseClients';

export async function createProduct(productData: any) {
  try {
    console.log("📦 API: Starting product creation...");
    console.log("📊 API: Received product data:", productData);
    
    const supabaseAdmin = createAdminClient();
    
    // Validate and sanitize the product data
    const sanitizedData = {
      name: productData.name?.trim() || 'Untitled Product',
      fullproductname: productData.fullproductname?.trim() || null,
      additionalfeatures: productData.additionalfeatures?.trim() || null,
      description: productData.description?.trim() || null,
      price: Math.max(0, Number(productData.price) || 0),
      inventory: Math.max(0, Number(productData.inventory) || 0),
      category: productData.category?.trim() || 'Uncategorized',
      height: productData.height && !isNaN(Number(productData.height)) ? Number(productData.height) : null,
      width: productData.width && !isNaN(Number(productData.width)) ? Number(productData.width) : null,
      thickness: productData.thickness && !isNaN(Number(productData.thickness)) ? Number(productData.thickness) : null,
      material: productData.material || 'Glass',
      type: productData.type || 'Tinted',
      image1: productData.image1 || null,
      image2: productData.image2 || null,
      image3: productData.image3 || null,
      image4: productData.image4 || null,
      image5: productData.image5 || null,
      fbx_url: productData.fbx_url || null,
      fbx_urls: productData.fbx_urls && productData.fbx_urls.length > 0 ? productData.fbx_urls : null,
      reserved_stock: 0,
      last_stock_update: new Date().toISOString(),
      stock_notification_sent: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log("✅ API: Validation passed, inserting with admin client...");
    console.log("🔍 API: Sanitized data:", sanitizedData);
    
    const { data: insertedProduct, error: insertErr } = await supabaseAdmin
      .from('products')
      .insert([sanitizedData])
      .select()
      .single();

    if (insertErr) {
      console.error("❌ API: Database insertion failed:", insertErr);
      console.error("❌ API: Error details:", {
        message: insertErr.message,
        details: insertErr.details,
        hint: insertErr.hint,
        code: insertErr.code
      });
      throw new Error(`Database error: ${insertErr.message}`);
    }

    console.log("✅ API: Product inserted successfully:", insertedProduct);
    
    return {
      success: true,
      data: insertedProduct
    };
    
  } catch (error: any) {
    console.error("💥 API: Product creation failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}