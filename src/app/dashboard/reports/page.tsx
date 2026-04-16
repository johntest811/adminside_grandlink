"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement, // NEW
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2"; // NEW: Doughnut

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement // NEW
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface SalesData {
  totalSales: number;
  totalProductsSold: number;
  totalOrders: number;
  successfulOrders: number;
  cancelledOrders: number;
  pendingOrders: number;
  averageOrderValue: number;
}

interface ProductData {
  id: string;
  name: string;
  inventory: number;
  reserved_stock: number;
  price: number;
  category: string;
  total_sold: number;
  revenue: number;
}

type DailySeries = {
  labels: string[];
  revenue: number[];
  products: number[];
  successfulOrders: number[];
  aov: number[];
};

type ReportBlockId =
  | "overview_kpis"
  | "executive_insights"
  | "risk_signals"
  | "trend_visualization"
  | "completed_orders"
  | "products_performance";

const REPORT_BLOCK_OPTIONS: Array<{ id: ReportBlockId; label: string }> = [
  { id: "overview_kpis", label: "OVERVIEW KPIS" },
  { id: "executive_insights", label: "EXECUTIVE INSIGHTS" },
  { id: "risk_signals", label: "RISK SIGNALS" },
  { id: "trend_visualization", label: "TREND VISUALIZATION" },
  { id: "completed_orders", label: "Completed Orders" },
  { id: "products_performance", label: "Products Performance" },
];

export default function ReportsPage() {
  const [salesData, setSalesData] = useState<SalesData>({
    totalSales: 0,
    totalProductsSold: 0,
    totalOrders: 0,
    successfulOrders: 0,
    cancelledOrders: 0,
    pendingOrders: 0,
    averageOrderValue: 0,
  });
  const [productsData, setProductsData] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [selectedReportBlocks, setSelectedReportBlocks] = useState<ReportBlockId[]>(
    REPORT_BLOCK_OPTIONS.map((block) => block.id)
  );
  const [isReportBlockPending, startReportBlockTransition] = useTransition();

  // Add refs to access the chart instances
  const revenueLineRef = useRef<any>(null);
  const kpiDoughnutRef = useRef<any>(null);        // NEW
  const ordersStatusRef = useRef<any>(null);       // NEW
  const categoryRevenueRef = useRef<any>(null);    // NEW

  // New: daily chart series
  const [dailySeries, setDailySeries] = useState<DailySeries>({
    labels: [],
    revenue: [],
    products: [],
    successfulOrders: [],
    aov: [],
  });

  useEffect(() => {
    loadCurrentAdmin();
  }, []);

  useEffect(() => {
    if (currentAdmin) {
      fetchReportsData();
      // Load completed orders list with details (server API, service role)
      fetchCompleted();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin, dateRange, selectedCategory, selectedStatus]);

  const loadCurrentAdmin = async () => {
    try {
      const sessionData = localStorage.getItem("adminSession");
      if (sessionData) {
        const admin = JSON.parse(sessionData);
        setCurrentAdmin(admin);
      }
    } catch (e) {
      console.error("Error loading admin session:", e);
    }
  };

  const buildDateKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

  const enumerateDates = (start: string, end: string) => {
    const out: string[] = [];
    const cur = new Date(start + "T00:00:00Z");
    const last = new Date(end + "T23:59:59Z");
    while (cur <= last) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  };

  const normalizeStatus = (value: unknown) => String(value || "").trim().toLowerCase();
  const normalizeCategory = (value: unknown) => String(value || "").trim().toLowerCase();

  const isSelectedStatus = useCallback((rawStatus: unknown) => {
    if (selectedStatus === "all") return true;

    const normalized = normalizeStatus(rawStatus);
    const successfulSet = new Set(["completed", "approved", "ready_for_delivery"]);
    const pendingSet = new Set(["pending_payment", "reserved", "in_production"]);

    if (selectedStatus === "successful") return successfulSet.has(normalized);
    if (selectedStatus === "pending") return pendingSet.has(normalized);
    return normalized === selectedStatus;
  }, [selectedStatus]);

  const isSelectedCategory = useCallback((rawCategory: unknown) => {
    if (selectedCategory === "all") return true;
    return normalizeCategory(rawCategory) === selectedCategory;
  }, [selectedCategory]);

  const hasReportBlock = (id: ReportBlockId) => selectedReportBlocks.includes(id);

  const selectAllReportBlocks = useCallback(() => {
    startReportBlockTransition(() => {
      setSelectedReportBlocks(REPORT_BLOCK_OPTIONS.map((block) => block.id));
    });
  }, [startReportBlockTransition]);

  const clearReportBlocks = useCallback(() => {
    startReportBlockTransition(() => {
      setSelectedReportBlocks([]);
    });
  }, [startReportBlockTransition]);

  const toggleReportBlock = useCallback((blockId: ReportBlockId, checked: boolean) => {
    startReportBlockTransition(() => {
      if (checked) {
        setSelectedReportBlocks((prev) => Array.from(new Set([...prev, blockId])));
        return;
      }
      setSelectedReportBlocks((prev) => prev.filter((item) => item !== blockId));
    });
  }, [startReportBlockTransition]);

  const fetchReportsData = async () => {
    try {
      setLoading(true);

      // Filter window
      const startISO = `${dateRange.startDate}T00:00:00Z`;
      const endISO = `${dateRange.endDate}T23:59:59Z`;

      // Orders within window
      const { data: ordersData, error: ordersError } = await supabase
        .from("user_items")
        .select(
          `
          id,
          quantity,
          status,
          order_status,
          created_at,
          meta,
          product_id,
          products!inner(name, price, category)
        `
        )
        .gte("created_at", startISO)
        .lte("created_at", endISO)
        .in("item_type", ["reservation", "order"]);

      if (ordersError) {
        console.error("Error fetching orders:", ordersError);
        throw ordersError;
      }

      const successStatuses = ["completed", "approved", "ready_for_delivery"];
      const statusOf = (row: any) => row.order_status || row.status;

      const filteredOrders = (ordersData || []).filter((order) => {
        const category = (order.products as any)?.category || "Uncategorized";
        const orderStatus = statusOf(order);
        return isSelectedCategory(category) && isSelectedStatus(orderStatus);
      });

      // Metrics
      const totalOrders = filteredOrders.length || 0;
      const successfulOrders =
        filteredOrders.filter((o) => successStatuses.includes(statusOf(o))).length ||
        0;
      const cancelledOrders =
        filteredOrders.filter((o) => statusOf(o) === "cancelled").length || 0;
      const pendingOrders =
        filteredOrders.filter((o) =>
          ["pending_payment", "reserved", "in_production"].includes(statusOf(o))
        ).length || 0;

      let totalSales = 0;
      let totalProductsSold = 0;

      filteredOrders.forEach((order) => {
        if (successStatuses.includes(statusOf(order))) {
          const price = (order.products as any)?.price || 0;
          totalSales += price * order.quantity;
          totalProductsSold += order.quantity;
        }
      });

      const averageOrderValue =
        successfulOrders > 0 ? totalSales / successfulOrders : 0;

      setSalesData({
        totalSales,
        totalProductsSold,
        totalOrders,
        successfulOrders,
        cancelledOrders,
        pendingOrders,
        averageOrderValue,
      });

      // Products snapshot + revenue per product inside window
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("*")
        .order("name");

      if (productsError) {
        console.error("Error fetching products:", productsError);
        throw productsError;
      }

      const categorySet = new Set<string>();
      (products || []).forEach((product: any) => {
        const label = String(product?.category || "Uncategorized").trim();
        if (label) categorySet.add(label);
      });
      setAvailableCategories(Array.from(categorySet).sort((a, b) => a.localeCompare(b)));

      const productsWithSales: ProductData[] = (products || [])
        .filter((product: any) => isSelectedCategory(product.category || "Uncategorized"))
        .map(
        (product) => {
          const productOrders =
            filteredOrders.filter(
              (o) =>
                o.product_id === product.id &&
                successStatuses.includes(statusOf(o))
            ) || [];

          const totalSold = productOrders.reduce(
            (sum, o) => sum + o.quantity,
            0
          );
          const revenue = productOrders.reduce(
            (sum, o) => sum + o.quantity * (product.price || 0),
            0
          );

          return {
            id: product.id,
            name: product.name,
            inventory: product.inventory || 0,
            reserved_stock: product.reserved_stock || 0,
            price: product.price || 0,
            category: product.category || "Uncategorized",
            total_sold: totalSold,
            revenue,
          };
        }
      );

      setProductsData(productsWithSales);

      // Daily series
      const labels = enumerateDates(dateRange.startDate, dateRange.endDate);
      const revByDay: Record<string, number> = {};
      const prodByDay: Record<string, number> = {};
      const sucOrdersByDay: Record<string, number> = {};

      labels.forEach((d) => {
        revByDay[d] = 0;
        prodByDay[d] = 0;
        sucOrdersByDay[d] = 0;
      });

      filteredOrders.forEach((o) => {
        const key = buildDateKey(o.created_at);
        if (!labels.includes(key)) return;
        if (successStatuses.includes(statusOf(o))) {
          const price = (o.products as any)?.price || 0;
          revByDay[key] += price * o.quantity;
          prodByDay[key] += o.quantity;
          sucOrdersByDay[key] += 1;
        }
      });

      const revenue = labels.map((d) => revByDay[d]);
      const productsSold = labels.map((d) => prodByDay[d]);
      const succOrders = labels.map((d) => sucOrdersByDay[d]);
      const aov = labels.map((d, i) =>
        succOrders[i] > 0 ? revenue[i] / succOrders[i] : 0
      );

      setDailySeries({
        labels,
        revenue,
        products: productsSold,
        successfulOrders: succOrders,
        aov,
      });
    } catch (error) {
      console.error("Error fetching reports data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompleted = async () => {
    try {
      const res = await fetch(`/api/order-management/list-items?status=completed`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load completed orders');
      setCompletedOrders((json.items || []).slice(0, 100));
    } catch (e) {
      console.warn('Completed orders load failed:', e);
      setCompletedOrders([]);
    }
  };

  const generatePDFReport = async () => {
    if (!currentAdmin) return;

    setGeneratingPDF(true);
    try {
      // Let the loading state paint first to avoid blocking the interaction frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      // Optionally ensure charts are fully painted before capture
      // await new Promise((r) => requestAnimationFrame(() => r(null)));

      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const currentDate = new Date().toLocaleDateString();
      const reportPeriod = `${dateRange.startDate} to ${dateRange.endDate}`;
      const generatedAt = new Date().toLocaleString();
      const brandPrimary: [number, number, number] = [127, 29, 29];
      const brandAccent: [number, number, number] = [153, 27, 27];
      const brandMuted: [number, number, number] = [120, 53, 15];
      const marginX = 14;

      // Helper: load public logo (AVIF) and convert to PNG data URL for jsPDF
      const loadImageAsPngDataUrl = () =>
        new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || 256;
            canvas.height = img.naturalHeight || 256;
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("Canvas context unavailable"));
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL("image/png");
            resolve({ dataUrl, width: canvas.width, height: canvas.height });
          };
          img.onerror = () => reject(new Error("Failed to load logo image"));
          img.src = "/ge-logo.avif"; // from public/
        });

      // Keep header background white for print clarity.
      const pageWidth = (pdf as any).internal.pageSize.getWidth();
      const pageHeight = (pdf as any).internal.pageSize.getHeight();
      const availableTableWidth = pageWidth - marginX * 2;

      const ensureSectionFits = (targetY: number, minRequiredHeight = 30) => {
        if (targetY + minRequiredHeight > pageHeight - marginX) {
          pdf.addPage();
          return marginX;
        }
        return targetY;
      };

      pdf.setFontSize(18);
      pdf.setTextColor(...brandPrimary);
      pdf.text("GrandLink Sales Intelligence Report", marginX + 2, 18);

      pdf.setFontSize(10);
      pdf.setTextColor(...brandMuted);
      pdf.text(`Prepared for: ${currentAdmin.username}`, marginX + 2, 24);
      pdf.text(`Generated: ${generatedAt}`, marginX + 2, 29);

      // Place logo on the right side of page 1 header.
      let headerBottomY = 32;
      try {
        const logo = await loadImageAsPngDataUrl();
        const imgW = 42;
        const imgH = imgW * (logo.height / Math.max(1, logo.width));
        const imgX = pageWidth - marginX - imgW;
        const imgY = 8;
        pdf.addImage(logo.dataUrl, "PNG", imgX, imgY, imgW, imgH);
        headerBottomY = Math.max(headerBottomY, imgY + imgH);
      } catch {
        // If logo fails to load, continue without blocking PDF generation.
      }

      const selectedBlocksLabel = selectedReportBlocks.length
        ? REPORT_BLOCK_OPTIONS.filter((block) => selectedReportBlocks.includes(block.id))
            .map((block) => block.label)
            .join(", ")
        : "None";

      autoTable(pdf, {
        startY: Math.max(36, headerBottomY + 8),
        head: [["Report Metadata", "Value"]],
        body: [
          ["Period", reportPeriod],
          ["Category filter", selectedCategory === "all" ? "All categories" : selectedCategory],
          ["Status filter", selectedStatus === "all" ? "All statuses" : selectedStatus],
          ["Included sections", selectedBlocksLabel],
          ["Generated on", currentDate],
        ],
        theme: "grid",
        headStyles: { fillColor: brandPrimary, textColor: [255, 255, 255] },
        styles: { fontSize: 9, cellPadding: 2.4, textColor: [31, 41, 55] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: marginX, right: marginX },
      });

      const sectionStartY = ((pdf as any).lastAutoTable?.finalY || 40) + 10;
      let currentY = sectionStartY;

      if (hasReportBlock("overview_kpis")) {
        pdf.setFontSize(14);
        pdf.setTextColor(...brandPrimary);
        pdf.text("Executive Sales Summary", marginX, sectionStartY);

        pdf.setFontSize(11);
        pdf.setTextColor(0, 0, 0);

        const salesSummaryData = [
          ["Metric", "Value"],
          ["Total Revenue", `₱${salesData.totalSales.toLocaleString()}`],
          ["Total Products Sold", salesData.totalProductsSold.toString()],
          ["Total Orders", salesData.totalOrders.toString()],
          ["Successful Orders", salesData.successfulOrders.toString()],
          ["Cancelled Orders", salesData.cancelledOrders.toString()],
          ["Pending Orders", salesData.pendingOrders.toString()],
          [
            "Average Order Value",
            `₱${salesData.averageOrderValue.toLocaleString()}`,
          ],
          [
            "Success Rate",
            `${
              salesData.totalOrders > 0
                ? ((salesData.successfulOrders / salesData.totalOrders) * 100).toFixed(
                    1
                  )
                : 0
            }%`,
          ],
        ];

        autoTable(pdf, {
          startY: sectionStartY + 5,
          head: [salesSummaryData[0]],
          body: salesSummaryData.slice(1),
          theme: "grid",
          headStyles: { fillColor: brandPrimary, textColor: [255, 255, 255] },
          styles: { fontSize: 9.5, cellPadding: 2.3, textColor: [31, 41, 55] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: marginX, right: marginX },
        });

        currentY = (pdf as any).lastAutoTable?.finalY
          ? (pdf as any).lastAutoTable.finalY + 16
          : sectionStartY + 70;
      }

      if (hasReportBlock("executive_insights")) {
        pdf.setFontSize(14);
        pdf.setTextColor(...brandPrimary);
        pdf.text("Analytics Highlights", marginX, currentY);

        const highlightRows = [
          ["Average revenue per day", `₱${Math.round(reportInsights.avgRevenuePerDay).toLocaleString()}`],
          ["Success / Cancel / Pending", `${reportInsights.successRate.toFixed(1)}% / ${reportInsights.cancelRate.toFixed(1)}% / ${reportInsights.pendingRate.toFixed(1)}%`],
          ["Average units per successful order", reportInsights.avgUnitsPerOrder.toFixed(2)],
          [
            "Top product by revenue",
            reportInsights.topRevenueProduct
              ? `${reportInsights.topRevenueProduct.name} (₱${Math.round(reportInsights.topRevenueProduct.revenue || 0).toLocaleString()})`
              : "N/A",
          ],
          [
            "Top category by revenue",
            `${reportInsights.topCategoryName} (₱${Math.round(reportInsights.topCategoryRevenue).toLocaleString()})`,
          ],
          ["Low-stock products (≤5 units)", reportInsights.lowStockProducts.toString()],
        ];

        autoTable(pdf, {
          startY: currentY + 5,
          head: [["Insight", "Value"]],
          body: highlightRows,
          theme: "grid",
          headStyles: { fillColor: brandAccent, textColor: [255, 255, 255] },
          margin: { left: marginX, right: marginX },
          styles: { fontSize: 9.5, cellPadding: 2.2, textColor: [31, 41, 55] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
      }

      // Products Inventory Section
      currentY = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      if (hasReportBlock("products_performance")) {
        currentY = ensureSectionFits(currentY, 34);
        pdf.setFontSize(14);
        pdf.setTextColor(...brandPrimary);
        pdf.text("Products Inventory and Performance", marginX, currentY);

        const productsTableData = productsData.map((product) => [
          product.name,
          product.category,
          product.inventory.toString(),
          product.reserved_stock.toString(),
          `₱${(product.price || 0).toLocaleString()}`,
          product.total_sold.toString(),
          `₱${(product.revenue || 0).toLocaleString()}`,
        ]);

        autoTable(pdf, {
          startY: currentY + 5,
          head: [
            [
              "Product Name",
              "Category",
              "In Stock",
              "Reserved",
              "Price",
              "Sold",
              "Revenue",
            ],
          ],
          body: productsTableData,
          theme: "grid",
          headStyles: { fillColor: brandPrimary, textColor: [255, 255, 255] },
          margin: { left: marginX, right: marginX },
          tableWidth: availableTableWidth,
          styles: {
            fontSize: 8.5,
            cellPadding: 1.9,
            overflow: "linebreak",
            textColor: [31, 41, 55],
          },
          bodyStyles: { valign: "top" },
          rowPageBreak: "avoid",
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: {
            0: { cellWidth: availableTableWidth * 0.27 },
            1: { cellWidth: availableTableWidth * 0.15 },
            2: { cellWidth: availableTableWidth * 0.09 },
            3: { cellWidth: availableTableWidth * 0.09 },
            4: { cellWidth: availableTableWidth * 0.12 },
            5: { cellWidth: availableTableWidth * 0.09 },
            6: { cellWidth: availableTableWidth * 0.19 },
          },
        });
      }

      // Completed Orders Section
      currentY = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      if (hasReportBlock("completed_orders")) {
      currentY = ensureSectionFits(currentY, 34);
      pdf.setFontSize(14);
      pdf.setTextColor(...brandPrimary);
      pdf.text("Completed Orders", marginX, currentY);

      const completedOrdersTableData = filteredCompletedOrders.map((order) => {
        const addr = order.address_details || {};
        const fullAddress = addr.address || 
          [addr.line1 || addr.street, addr.barangay, addr.city, addr.province || addr.region, addr.postal_code]
            .filter(Boolean)
            .join(', ') || 
          order.delivery_address || 
          '—';
        
        const customerName = addr.full_name || 
          (addr.first_name && addr.last_name ? `${addr.first_name} ${addr.last_name}` : '') ||
          order.customer?.name || 
          order.customer_name || 
          '—';
        
        const phone = addr.phone || order.customer?.phone || order.customer_phone || '—';
        const email = addr.email || order.customer?.email || order.customer_email || '—';
        const branch = addr.branch || '—';
        
        return [
          new Date(order.created_at).toLocaleDateString(),
          customerName,
          `${phone}\n${email}`,
          fullAddress,
          branch,
          order.product_details?.name || order.meta?.product_name || order.product_id || '—',
          order.quantity?.toString() || '0',
          `₱${Number(order.total_paid || 0).toLocaleString()}`,
        ];
      });

      autoTable(pdf, {
        startY: currentY + 5,
        head: [
          [
            "Date",
            "Customer",
            "Contact",
            "Address",
            "Branch",
            "Product",
            "Qty",
            "Total Paid",
          ],
        ],
        body: completedOrdersTableData.length > 0 ? completedOrdersTableData : [['No completed orders in the selected date range', '', '', '', '', '', '', '']],
        theme: "grid",
        headStyles: { fillColor: brandPrimary, textColor: [255, 255, 255] },
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 7.6, cellPadding: 1.8, overflow: 'linebreak', textColor: [31, 41, 55] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        bodyStyles: { valign: 'top' },
        pageBreak: 'auto',
        rowPageBreak: 'avoid',
        tableWidth: availableTableWidth,
        columnStyles: {
          0: { cellWidth: availableTableWidth * 0.11 }, // Date
          1: { cellWidth: availableTableWidth * 0.14 }, // Customer
          2: { cellWidth: availableTableWidth * 0.16 }, // Contact
          3: { cellWidth: availableTableWidth * 0.23 }, // Address
          4: { cellWidth: availableTableWidth * 0.08 }, // Branch
          5: { cellWidth: availableTableWidth * 0.16 }, // Product
          6: { cellWidth: availableTableWidth * 0.05 }, // Qty
          7: { cellWidth: availableTableWidth * 0.07 }, // Total Paid
        },
      });
      }

      // Products Inventory & Performance Section
      currentY = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      if (hasReportBlock("trend_visualization")) {
      currentY = ensureSectionFits(currentY, 34);
      pdf.setFontSize(14);
      pdf.setTextColor(...brandPrimary);
      pdf.text("Category Performance", marginX, currentY);

      const categoryData = productsData.reduce((acc, product) => {
        const category = product.category || "Uncategorized";
        if (!acc[category]) {
          acc[category] = {
            totalInventory: 0,
            totalSold: 0,
            totalRevenue: 0,
            productCount: 0,
          };
        }
        acc[category].totalInventory += product.inventory;
        acc[category].totalSold += product.total_sold;
        acc[category].totalRevenue += product.revenue;
        acc[category].productCount += 1;
        return acc;
      }, {} as any);

      const categoryTableData = Object.entries(categoryData).map(
        ([category, data]: [string, any]) => [
          category,
          data.productCount.toString(),
          data.totalInventory.toString(),
          data.totalSold.toString(),
          `₱${(data.totalRevenue || 0).toLocaleString()}`,
        ]
      );

      autoTable(pdf, {
        startY: currentY + 5,
        head: [["Category", "Products", "Total Stock", "Total Sold", "Total Revenue"]],
        body: categoryTableData,
        theme: "grid",
        headStyles: { fillColor: brandAccent, textColor: [255, 255, 255] },
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 9, cellPadding: 2.1, textColor: [31, 41, 55] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      }

      // --- NEW: Embed charts as images ---
      const pdfPageWidth = pdf.internal.pageSize.getWidth();
      const margin = marginX;

      let y = (pdf as any).lastAutoTable?.finalY
        ? (pdf as any).lastAutoTable.finalY + 20
        : 90;

      const getChartImage = (chartRef: any) => {
        const chart = chartRef?.current;
        if (!chart) return null;

        // Try both Chart.js APIs to get a base64 image
        const canvas: HTMLCanvasElement | undefined =
          chart.canvas || chart.ctx?.canvas || chartRef?.current?.canvas;
        const imgData =
          typeof chart.toBase64Image === "function"
            ? chart.toBase64Image()
            : canvas?.toDataURL?.("image/png");

        if (!imgData) return null;

        return {
          imgData,
          width: canvas?.width || 800,
          height: canvas?.height || 400,
        };
      };

      // Charts section
      pdf.setFontSize(14);
      pdf.setTextColor(...brandPrimary);
      if (y + 12 > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      const hasAnySelectedChart = hasReportBlock("trend_visualization");

      if (hasAnySelectedChart) {
        pdf.text("Charts and Visual Trends", margin, y);
        y += 8;

        const selectedCharts: Array<{ title: string; image: { imgData: string; width: number; height: number } }> = [];
        const revenueOverTimeImage = getChartImage(revenueLineRef);
        if (revenueOverTimeImage) {
          selectedCharts.push({ title: "Revenue Over Time", image: revenueOverTimeImage });
        }

        const kpisOverviewImage = getChartImage(kpiDoughnutRef);
        if (kpisOverviewImage) {
          selectedCharts.push({ title: "KPIs Overview", image: kpisOverviewImage });
        }

        const ordersStatusImage = getChartImage(ordersStatusRef);
        if (ordersStatusImage) {
          selectedCharts.push({ title: "Orders Status Breakdown", image: ordersStatusImage });
        }

        const revenueByCategoryImage = getChartImage(categoryRevenueRef);
        if (revenueByCategoryImage) {
          selectedCharts.push({ title: "Revenue by Category", image: revenueByCategoryImage });
        }

        const chartGap = 6;
        const chartBoxW = (pdfPageWidth - margin * 2 - chartGap) / 2;
        const chartTitleH = 5;
        const chartImageH = 56;
        const chartRowH = chartTitleH + chartImageH + 8;

        for (let i = 0; i < selectedCharts.length; i += 2) {
          if (y + chartRowH > pageHeight - margin - 10) {
            pdf.addPage();
            y = margin;
          }

          const rowItems = selectedCharts.slice(i, i + 2);
          rowItems.forEach((item, colIndex) => {
            const x = margin + colIndex * (chartBoxW + chartGap);
            pdf.setFontSize(11);
            pdf.setTextColor(...brandPrimary);
            pdf.text(item.title, x, y);

            const ratio = item.image.width > 0 ? item.image.height / item.image.width : 0.5;
            const fitByWidthH = chartBoxW * ratio;
            const imgW = fitByWidthH <= chartImageH ? chartBoxW : chartImageH / Math.max(ratio, 0.01);
            const imgH = Math.min(chartImageH, fitByWidthH);
            const offsetX = x + (chartBoxW - imgW) / 2;
            const imageY = y + chartTitleH;

            pdf.addImage(item.image.imgData, "PNG", offsetX, imageY, imgW, imgH);
          });

          y += chartRowH;
        }
      }

      // Footer page numbers
      const pageCount = pdf.getNumberOfPages();
      pdf.setFontSize(8);
      pdf.setTextColor(...brandMuted);
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.text(
          `Page ${i} of ${pageCount}`,
          pdf.internal.pageSize.getWidth() - 34,
          pdf.internal.pageSize.getHeight() - 10
        );
        pdf.text(
          `GrandLink Internal Report • ${reportPeriod}`,
          marginX,
          pdf.internal.pageSize.getHeight() - 10
        );
      }

      const fileName = `GrandLink_Sales_Report_${dateRange.startDate}_to_${dateRange.endDate}.pdf`;
      pdf.save(fileName);

      // Optional: activity log
      try {
        await fetch("/api/activity-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "generate",
            entity_type: "sales_report",
            entity_id: `report_${Date.now()}`,
            details: `Admin ${currentAdmin.username} generated sales report for period ${reportPeriod}`,
            page: "Reports",
            metadata: {
              reportPeriod,
              totalSales: salesData.totalSales,
              totalOrders: salesData.totalOrders,
              successfulOrders: salesData.successfulOrders,
              productsCount: productsData.length,
              fileName,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString(),
            },
          }),
        });
      } catch (logError) {
        console.warn("Failed to log report generation:", logError);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF report. Please try again.");
    } finally {
      setGeneratingPDF(false);
    }
  };

  // REMOVE: kpiBarData and replace with doughnut data
  // const kpiBarData = useMemo(...)

  // Better KPI overview: multi-axis combo chart over the selected period
  const kpiDoughnutData = useMemo(
    () => ({
      labels: dailySeries.labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Products Sold",
          data: dailySeries.products,
          backgroundColor: "rgba(37,99,235,0.6)",
          borderColor: "#2563EB",
          borderWidth: 1,
          yAxisID: "y",
        },
        {
          type: "bar" as const,
          label: "Successful Orders",
          data: dailySeries.successfulOrders,
          backgroundColor: "rgba(124,58,237,0.6)",
          borderColor: "#7C3AED",
          borderWidth: 1,
          yAxisID: "y",
        },
        {
          type: "line" as const,
          label: "Avg Order Value (₱)",
          data: dailySeries.aov.map((n) => Number(n.toFixed(2))),
          borderColor: "#F97316",
          backgroundColor: "rgba(249,115,22,0.25)",
          tension: 0.3,
          yAxisID: "y1",
          pointRadius: 2,
        },
      ],
    }),
    [dailySeries]
  );

  const ordersStatusData = useMemo(
    () => ({
      labels: ["Successful", "Cancelled", "Pending"],
      datasets: [
        {
          label: "Orders",
          data: [
            salesData.successfulOrders,
            salesData.cancelledOrders,
            salesData.pendingOrders,
          ],
          backgroundColor: ["#16A34A", "#DC2626", "#F59E0B"],
          borderColor: ["#15803D", "#B91C1C", "#D97706"],
          borderWidth: 1,
        },
      ],
    }),
    [salesData]
  );

  const categoryRevenueData = useMemo(() => {
    const map = new Map<string, number>();
    productsData.forEach((p) => {
      const key = p.category || "Uncategorized";
      map.set(key, (map.get(key) || 0) + (p.revenue || 0));
    });
    const labels = Array.from(map.keys());
    const values = labels.map((l) => map.get(l) || 0);
    return {
      labels,
      datasets: [
        {
          label: "Revenue by Category (₱)",
          data: values,
          backgroundColor: "#0EA5E9",
          borderColor: "#0284C7",
        },
      ],
    };
  }, [productsData]);

  const revenueLineData = useMemo(
    () => ({
      labels: dailySeries.labels,
      datasets: [
        {
          label: "Revenue (₱)",
          data: dailySeries.revenue,
          borderColor: "#16A34A",
          backgroundColor: "rgba(22,163,74,0.2)",
          tension: 0.25,
        },
      ],
    }),
    [dailySeries]
  );

  const reportInsights = useMemo(() => {
    const periodDays = Math.max(1, dailySeries.labels.length || 1);
    const successRate = salesData.totalOrders
      ? (salesData.successfulOrders / salesData.totalOrders) * 100
      : 0;
    const cancelRate = salesData.totalOrders
      ? (salesData.cancelledOrders / salesData.totalOrders) * 100
      : 0;
    const pendingRate = salesData.totalOrders
      ? (salesData.pendingOrders / salesData.totalOrders) * 100
      : 0;

    const avgRevenuePerDay = salesData.totalSales / periodDays;
    const avgUnitsPerOrder = salesData.successfulOrders
      ? salesData.totalProductsSold / salesData.successfulOrders
      : 0;

    const sortedByRevenue = [...productsData].sort((a, b) => b.revenue - a.revenue);
    const topRevenueProduct = sortedByRevenue[0] || null;

    const categoryRevenueMap = productsData.reduce((acc, product) => {
      const key = product.category || "Uncategorized";
      acc[key] = (acc[key] || 0) + (product.revenue || 0);
      return acc;
    }, {} as Record<string, number>);

    const topCategoryEntry = Object.entries(categoryRevenueMap).sort((a, b) => b[1] - a[1])[0];
    const topCategoryName = topCategoryEntry?.[0] || "N/A";
    const topCategoryRevenue = topCategoryEntry?.[1] || 0;

    const lowStockProducts = productsData.filter((product) => (product.inventory || 0) <= 5).length;
    const highDemandLowStock = productsData
      .filter((product) => (product.inventory || 0) <= 5 && (product.total_sold || 0) > 0)
      .sort((a, b) => b.total_sold - a.total_sold)
      .slice(0, 5);

    return {
      periodDays,
      successRate,
      cancelRate,
      pendingRate,
      avgRevenuePerDay,
      avgUnitsPerOrder,
      topRevenueProduct,
      topCategoryName,
      topCategoryRevenue,
      lowStockProducts,
      highDemandLowStock,
    };
  }, [dailySeries.labels.length, productsData, salesData]);

  const filteredCompletedOrders = useMemo(() => {
    return completedOrders
      .filter((order) => {
        const created = String(order?.created_at || "");
        const day = created ? new Date(created).toISOString().slice(0, 10) : "";
        if (!day) return false;
        if (day < dateRange.startDate || day > dateRange.endDate) return false;

        const category = order?.product_details?.category || order?.meta?.category || "Uncategorized";
        if (!isSelectedCategory(category)) return false;

        const status = normalizeStatus(order?.order_status || order?.status || "completed");
        if (!isSelectedStatus(status)) return false;

        return true;
      })
      .slice(0, 100);
  }, [completedOrders, dateRange.endDate, dateRange.startDate, isSelectedCategory, isSelectedStatus]);

  const exportFilteredResults = () => {
    const lines: string[] = [];
    const selectedReportLabels = REPORT_BLOCK_OPTIONS
      .filter((block) => selectedReportBlocks.includes(block.id))
      .map((block) => block.label);

    lines.push(`Generated By,${JSON.stringify(currentAdmin?.username || "Unknown Admin")}`);
    lines.push(`Start Date,${dateRange.startDate}`);
    lines.push(`End Date,${dateRange.endDate}`);
    lines.push(`Category Filter,${JSON.stringify(selectedCategory === "all" ? "All" : selectedCategory)}`);
    lines.push(`Status Filter,${JSON.stringify(selectedStatus === "all" ? "All" : selectedStatus)}`);
    lines.push(`Selected Reports,${JSON.stringify(selectedReportLabels.join(" | "))}`);
    lines.push("");

    if (hasReportBlock("overview_kpis")) {
      lines.push("KPI,Value");
      lines.push(`Total Revenue,${salesData.totalSales}`);
      lines.push(`Total Products Sold,${salesData.totalProductsSold}`);
      lines.push(`Total Orders,${salesData.totalOrders}`);
      lines.push(`Successful Orders,${salesData.successfulOrders}`);
      lines.push(`Cancelled Orders,${salesData.cancelledOrders}`);
      lines.push(`Pending Orders,${salesData.pendingOrders}`);
      lines.push(`Average Order Value,${salesData.averageOrderValue}`);
      lines.push("");
    }

    if (hasReportBlock("executive_insights")) {
      lines.push("Insight,Value");
      lines.push(`Period Length (days),${reportInsights.periodDays}`);
      lines.push(`Average Revenue Per Day,${Math.round(reportInsights.avgRevenuePerDay)}`);
      lines.push(`Success Rate (%),${reportInsights.successRate.toFixed(1)}`);
      lines.push(`Cancelled Rate (%),${reportInsights.cancelRate.toFixed(1)}`);
      lines.push(`Pending Rate (%),${reportInsights.pendingRate.toFixed(1)}`);
      lines.push(`Average Units Per Successful Order,${reportInsights.avgUnitsPerOrder.toFixed(2)}`);
      lines.push(`Top Product By Revenue,${JSON.stringify(reportInsights.topRevenueProduct?.name || "N/A")}`);
      lines.push(`Top Category By Revenue,${JSON.stringify(reportInsights.topCategoryName)}`);
      lines.push(`Low-Stock Products (<=5),${reportInsights.lowStockProducts}`);
      lines.push("");
    }

    if (hasReportBlock("risk_signals")) {
      lines.push("Risk Product,Current Stock,Units Sold,Revenue");
      if (reportInsights.highDemandLowStock.length === 0) {
        lines.push(`${JSON.stringify("No immediate low-stock demand risk in the selected period")},,,`);
      } else {
        reportInsights.highDemandLowStock.forEach((product) => {
          lines.push(
            [
              JSON.stringify(product.name || ""),
              Number(product.inventory || 0),
              Number(product.total_sold || 0),
              Number(product.revenue || 0),
            ].join(",")
          );
        });
      }
      lines.push("");
    }

    if (hasReportBlock("products_performance")) {
      lines.push("Product,Category,Stock,Reserved,Price,Units Sold,Revenue");
      productsData.forEach((product) => {
        lines.push(
          [
            JSON.stringify(product.name || ""),
            JSON.stringify(product.category || "Uncategorized"),
            product.inventory,
            product.reserved_stock,
            product.price,
            product.total_sold,
            product.revenue,
          ].join(",")
        );
      });
      lines.push("");
    }

    if (hasReportBlock("trend_visualization")) {
      lines.push("Date,Revenue,Products Sold,Successful Orders,AOV");
      dailySeries.labels.forEach((day, index) => {
        lines.push(
          [
            day,
            dailySeries.revenue[index] || 0,
            dailySeries.products[index] || 0,
            dailySeries.successfulOrders[index] || 0,
            dailySeries.aov[index] || 0,
          ].join(",")
        );
      });
      lines.push("");

      lines.push("Order Status,Count");
      lines.push(`Successful,${salesData.successfulOrders}`);
      lines.push(`Cancelled,${salesData.cancelledOrders}`);
      lines.push(`Pending,${salesData.pendingOrders}`);
      lines.push("");

      lines.push("Category,Revenue");
      const categoryRevenueMap = productsData.reduce((acc, product) => {
        const key = product.category || "Uncategorized";
        acc[key] = (acc[key] || 0) + (product.revenue || 0);
        return acc;
      }, {} as Record<string, number>);

      Object.entries(categoryRevenueMap).forEach(([category, revenue]) => {
        lines.push([JSON.stringify(category), revenue].join(","));
      });
      lines.push("");
    }

    if (hasReportBlock("completed_orders")) {
      lines.push("Completed Date,Customer,Product,Qty,Total Paid");
      filteredCompletedOrders.forEach((order) => {
        const customer = order?.address_details?.full_name || order?.customer_name || "";
        const product = order?.product_details?.name || order?.meta?.product_name || order?.product_id || "";
        lines.push(
          [
            JSON.stringify(String(order?.created_at || "").slice(0, 10)),
            JSON.stringify(customer),
            JSON.stringify(product),
            Number(order?.quantity || 0),
            Number(order?.total_paid || 0),
          ].join(",")
        );
      });
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `custom_report_${dateRange.startDate}_to_${dateRange.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Sales Reports</h1>
        <div className="bg-white p-6 rounded-lg shadow-sm text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="text-sm text-gray-500 mt-2">Loading reports data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-7 rounded-3xl bg-slate-50 p-4 md:p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Sales Reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Build custom analytics views by combining filters, section selection, and export tools.
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm text-slate-600 shadow-sm">
            Report by: {currentAdmin?.username || "Unknown Admin"}
          </div>
        </div>
      </div>
      </div>

      {/* Date Range Filter */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-4 border-b border-slate-200 pb-3">
          <h2 className="text-lg font-semibold text-slate-900">Report Builder</h2>
          <p className="mt-1 text-sm text-slate-600">Set filters, choose report sections, then generate PDF or export CSV.</p>
        </div>
        {/* Inputs row */}
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, startDate: e.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-black shadow-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              End Date
            </label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, endDate: e.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-black shadow-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-black shadow-sm"
            >
              <option value="all">All Categories</option>
              {availableCategories.map((category) => (
                <option key={category} value={normalizeCategory(category)}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-black shadow-sm"
            >
              <option value="all">All Statuses</option>
              <option value="successful">Successful (completed/approved/ready)</option>
              <option value="pending">Pending (payment/reserved/production)</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
              <option value="approved">Approved</option>
              <option value="ready_for_delivery">Ready for Delivery</option>
              <option value="reserved">Reserved</option>
              <option value="pending_payment">Pending Payment</option>
              <option value="in_production">In Production</option>
            </select>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-700">Generate report sections</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllReportBlocks}
                className="text-xs font-medium text-blue-700 hover:text-blue-900"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={clearReportBlocks}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {REPORT_BLOCK_OPTIONS.map((block) => {
              const checked = selectedReportBlocks.includes(block.id);
              return (
                <label key={block.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleReportBlock(block.id, e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{block.label}</span>
                </label>
              );
            })}
          </div>
          {isReportBlockPending && (
            <div className="mt-2 text-xs text-slate-500">Updating selected sections...</div>
          )}
        </div>

        {/* Action row: place button below date inputs */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={generatePDFReport}
            disabled={generatingPDF || selectedReportBlocks.length === 0}
            className="bg-red-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {generatingPDF ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Generating...</span>
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span>Generate PDF Report</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={exportFilteredResults}
            disabled={selectedReportBlocks.length === 0}
            className="bg-gray-800 text-white px-6 py-2 rounded-lg font-medium hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export Filtered Results (CSV)
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {hasReportBlock("overview_kpis") && (
      <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Overview KPIs</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold text-green-600">
                ₱{salesData.totalSales.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">
                Products Sold
              </p>
              <p className="text-2xl font-bold text-blue-600">
                {salesData.totalProductsSold}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">
                Successful Orders
              </p>
              <p className="text-2xl font-bold text-purple-600">
                {salesData.successfulOrders}
              </p>
            </div>
            <div className="p-3 bg-purple-100 rounded-full">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">
                Average Order Value
              </p>
              <p className="text-2xl font-bold text-orange-600">
                ₱{salesData.averageOrderValue.toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-orange-100 rounded-full">
              <svg
                className="w-6 h-6 text-orange-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
      </section>
      )}

      {hasReportBlock("executive_insights") && (
      <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Executive Insights</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Performance Snapshot</h3>
          <div className="space-y-2 text-sm text-gray-700">
            <div className="flex justify-between gap-3">
              <span>Period length</span>
              <span className="font-medium text-gray-900">{reportInsights.periodDays} days</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Avg revenue/day</span>
              <span className="font-medium text-green-700">₱{Math.round(reportInsights.avgRevenuePerDay).toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Avg units/order</span>
              <span className="font-medium text-gray-900">{reportInsights.avgUnitsPerOrder.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Order Health</h3>
          <div className="space-y-2 text-sm text-gray-700">
            <div className="flex justify-between gap-3">
              <span>Successful</span>
              <span className="font-medium text-green-700">{reportInsights.successRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Cancelled</span>
              <span className="font-medium text-red-700">{reportInsights.cancelRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Pending</span>
              <span className="font-medium text-amber-700">{reportInsights.pendingRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Revenue Leaders</h3>
          <div className="space-y-2 text-sm text-gray-700">
            <div>
              <div className="text-xs text-gray-500">Top Product</div>
              <div className="font-medium text-gray-900">
                {reportInsights.topRevenueProduct
                  ? `${reportInsights.topRevenueProduct.name} (₱${Math.round(reportInsights.topRevenueProduct.revenue || 0).toLocaleString()})`
                  : "N/A"}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Top Category</div>
              <div className="font-medium text-gray-900">
                {reportInsights.topCategoryName} (₱{Math.round(reportInsights.topCategoryRevenue).toLocaleString()})
              </div>
            </div>
            <div className="text-xs text-gray-600">
              Low-stock products (≤5 units): <span className="font-semibold">{reportInsights.lowStockProducts}</span>
            </div>
          </div>
        </div>
      </div>
      </section>
      )}

      {hasReportBlock("risk_signals") && (
      <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Risk Signals</h2>
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">High-demand, low-stock products</h3>
        {reportInsights.highDemandLowStock.length === 0 ? (
          <p className="text-sm text-gray-600">No immediate low-stock demand risk in the selected period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Current Stock</th>
                  <th className="py-2 pr-4">Units Sold</th>
                  <th className="py-2 pr-4">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {reportInsights.highDemandLowStock.map((product) => (
                  <tr key={product.id} className="border-b last:border-b-0 text-gray-800">
                    <td className="py-2 pr-4 font-medium">{product.name}</td>
                    <td className="py-2 pr-4">{product.inventory}</td>
                    <td className="py-2 pr-4">{product.total_sold}</td>
                    <td className="py-2 pr-4">₱{Math.round(product.revenue || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </section>
      )}

      {/* Charts */}
      {hasReportBlock("trend_visualization") && (
      <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Trend Visualizations</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Revenue over time
          </h3>
          <div className="h-[240px]">
            <Line
              ref={revenueLineRef}
              data={revenueLineData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: {
                  y: {
                    ticks: { callback: (v) => `₱${Number(v).toLocaleString()}` },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* KPIs combo: bars (Products/Orders) + line (AOV) */}
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            KPIs overview
          </h3>
          <div className="mx-auto h-[240px]">
            <Bar
              ref={kpiDoughnutRef}
              data={kpiDoughnutData as any}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: true, position: "top" },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const dsLabel = ctx.dataset.label || "";
                        const val = ctx.parsed?.y ?? ctx.parsed;
                        return dsLabel.includes("(₱)")
                          ? `${dsLabel}: ₱${Number(val || 0).toLocaleString()}`
                          : `${dsLabel}: ${Number(val || 0).toLocaleString()}`;
                      },
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    title: { display: true, text: "Counts" },
                  },
                  y1: {
                    position: "right",
                    beginAtZero: true,
                    grid: { drawOnChartArea: false },
                    ticks: { callback: (v) => `₱${Number(v).toLocaleString()}` },
                    title: { display: true, text: "Avg Order Value (₱)" },
                  },
                },
              }}
              height={240}
            />
          </div>
        </div>
      </div>
      </section>
      )}

      {/* NEW extra charts row */}
      {hasReportBlock("trend_visualization") && (
      <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Breakdowns</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Orders status breakdown
          </h3>
          <div className="mx-auto flex justify-center">
            <div className="w-[220px] h-[220px]">
              <Doughnut
                ref={ordersStatusRef}
                data={ordersStatusData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false, // enforce 180x180
                  plugins: { legend: { display: true, position: "bottom" } },
                  cutout: "55%",
                }}
              />
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Revenue by category
          </h3>
          <div className="h-[240px]">
            <Bar
              ref={categoryRevenueRef}
              data={categoryRevenueData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (v) => `₱${Number(v).toLocaleString()}`,
                    },
                  },
                  x: { ticks: { maxRotation: 45, minRotation: 0 } },
                },
              }}
            />
          </div>
        </div>
      </div>
      </section>
      )}

      {/* Completed Orders Section newest*/}
      {hasReportBlock("completed_orders") && (
      <div className="bg-white rounded-lg shadow-sm border" id="completed-orders-section">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Completed Orders</h2>
          <p className="text-sm text-gray-600 mt-1">
            Showing latest {Math.min(filteredCompletedOrders.length, 100)} completed orders with customer and address details
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact Info
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Full Address
                </th>
                {/* <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Branch
                </th> */}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Qty
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Paid
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredCompletedOrders.map((order) => {
                const addr = order.address_details || {};
                const fullAddress = addr.address || 
                  [addr.line1 || addr.street, addr.barangay, addr.city, addr.province || addr.region, addr.postal_code]
                    .filter(Boolean)
                    .join(', ') || 
                  order.delivery_address || 
                  '—';
                
                const customerName = addr.full_name || 
                  (addr.first_name && addr.last_name ? `${addr.first_name} ${addr.last_name}` : '') ||
                  order.customer?.name || 
                  order.customer_name || 
                  '—';
                
                const phone = addr.phone || order.customer?.phone || order.customer_phone || '—';
                const email = addr.email || order.customer?.email || order.customer_email || '—';
                return (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {new Date(order.created_at).toLocaleDateString()}
                      <div className="text-xs text-gray-500">
                        {new Date(order.created_at).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="font-medium text-gray-900">{customerName}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <span className="text-xs">{phone}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span className="text-xs text-gray-600">{email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs break-words">
                      {fullAddress}
                    </td>
                    {/* <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {branch}
                    </td> */}
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {order.product_details?.name || order.meta?.product_name || order.product_id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center">
                      {order.quantity}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-green-600">
                      ₱{Number(order.total_paid || 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {filteredCompletedOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="text-gray-500">
                      <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm font-medium">No completed orders found</p>
                      <p className="text-sm">Try adjusting your date range</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Products Performance Table (unchanged content below) */}
      {hasReportBlock("products_performance") && (
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Products Performance
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  In Stock
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reserved
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Units Sold
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {productsData.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {product.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                      {product.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ₱{(product.price || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span
                      className={`font-medium ${
                        product.inventory <= 5 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {product.inventory}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {product.reserved_stock}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {product.total_sold}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                    ₱{(product.revenue || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {productsData.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📊</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No products data found
          </h3>
          <p className="text-gray-500">
            No products available for the selected date range.
          </p>
        </div>
      )}
    </div>
  );
}