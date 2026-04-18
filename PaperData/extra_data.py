import os
import json
import base64
import fitz  # PyMuPDF
import pandas as pd  # 处理 Excel 的神器
from openai import OpenAI

# 导入你的提示词
from prompts_diffusion import ANTI_HALLUCINATION_PROMPT, DIFFUSION_EXTRACTION_PROMPT

from rdkit_feature_engineering import process_extracted_records

# =====================================================================
# 第一步：API 配置 (请替换为你的 Key)
# =====================================================================
DEEPSEEK_API_KEY = "sk-0832fe714b324b8fba5b0e3741081d2b"
QWEN_API_KEY = "sk-hvwjrkliezvytsalpbfgjsxuxapcuvzejflukymodzydlbcl" 

DEEPSEEK_BASE_URL = "https://api.deepseek.com" 
QWEN_BASE_URL = "https://api.siliconflow.cn/v1"

client_deepseek = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
client_qwen = OpenAI(api_key=QWEN_API_KEY, base_url=QWEN_BASE_URL)

# =====================================================================
# 第二步：核心功能函数
# =====================================================================
def analyze_image_with_qwen(base64_image):
    try:
        response = client_qwen.chat.completions.create(
            model="Qwen/Qwen3-VL-32B-Instruct", 
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "你是一个严谨的科学图表数据读取专家。请仔细观察这张图表，提取其中关于扩散系数、温度、孔径等数值。如果这只是一些普通的仪器照片或无关配图，请回复“无相关数据”。"},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                    ]
                }
            ]
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"  [!] Qwen 读图失败: {e}")
        return ""

def process_pdf_automatically(file_path):
    text_content = ""
    all_image_descriptions = ""
    try:
        doc = fitz.open(file_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            text_content += page.get_text() + "\n"
            
            image_list = page.get_images(full=True)
            for img in image_list:
                base_image = doc.extract_image(img[0])
                # 过滤小图标，只解析大图表
                if base_image["width"] > 200 and base_image["height"] > 200: 
                    print(f"  👀 发现大图表 (第{page_num+1}页)，正在请千问解析...")
                    base64_image = base64.b64encode(base_image["image"]).decode('utf-8')
                    desc = analyze_image_with_qwen(base64_image)
                    if desc and "无相关数据" not in desc:
                        all_image_descriptions += f"\n--- 第{page_num+1}页 图表信息 ---\n{desc}\n"
    except Exception as e:
        print(f"  [!] 读取 PDF 失败: {e}")
        
    return text_content, all_image_descriptions

def extract_data_with_deepseek(paper_text, image_description=""):
    combined_content = f"文献原文：\n{paper_text}\n\n"
    if image_description:
        combined_content += f"图表数据补充（来自视觉模型）：\n{image_description}\n\n"
        
    final_prompt = f"{DIFFUSION_EXTRACTION_PROMPT}\n\n{combined_content}"

    try:
        response = client_deepseek.chat.completions.create(
            model="deepseek-chat", 
            response_format={"type": "json_object"}, 
            temperature=0.1, 
            messages=[
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user", "content": final_prompt}
            ]
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"  [!] DeepSeek 提取失败: {e}")
        return None

# =====================================================================
# 第三步：批量处理与特征自动扩列
# =====================================================================
def batch_process_papers(reference_folder="Reference", excel_filename="Extraction_Results.xlsx", max_process_once=5):
    if not os.path.exists(reference_folder):
        print(f"❌ 找不到文件夹 '{reference_folder}'，请先创建并放入 PDF 文件！")
        return

    empty_log_file = "Empty_Papers_Log.txt"
    processed_log_file = "Processed_Log.txt"
    
    # 读取已处理记录
    processed_files = set()
    if os.path.exists(processed_log_file):
        with open(processed_log_file, 'r', encoding='utf-8') as f:
            processed_files = set(line.strip() for line in f)

    # 读取现有数据
    all_extracted_data = []
    if os.path.exists(excel_filename):
        existing_df = pd.read_excel(excel_filename)
        all_extracted_data = existing_df.to_dict('records')

    all_pdfs = [f for f in os.listdir(reference_folder) if f.lower().endswith('.pdf')]
    pending_pdfs = [f for f in all_pdfs if f not in processed_files]
    
    print(f"📊 共有 {len(all_pdfs)} 篇，已处理 {len(processed_files)} 篇，待处理 {len(pending_pdfs)} 篇。")
    print(f"⚙️ 本次处理上限: {max_process_once} 篇。")
    print("-" * 50)

    processed_count = 0
    for pdf_file in pending_pdfs:
        if processed_count >= max_process_once:
            print(f"\n🛑 已达到本次处理上限 ({max_process_once}篇)，脚本暂停。")
            break
            
        print(f"\n▶️ 正在处理 [{processed_count+1}]: {pdf_file}")
        file_path = os.path.join(reference_folder, pdf_file)
        
        paper_text, images_info = process_pdf_automatically(file_path)
        
        if paper_text or images_info:
            result = extract_data_with_deepseek(paper_text, images_info)
            
            if result:
                # 📢 第一时间打印出模型发现的“新特征警报”！
                alerts = result.get("new_feature_alerts", [])
                for alert in alerts:
                    print(f"  🌟 {alert}")

                extracted_records = result.get("data", [])
                
                if len(extracted_records) == 0:
                    print(f"  ⚠️ 提取结果为空 (无明确扩散数据，已过滤)")
                    with open(empty_log_file, 'a', encoding='utf-8') as ef:
                        ef.write(f"{pdf_file} | 原因: {result.get('reasoning', '无')}\n")
                else:
                    print(f"  ✅ 成功提取到 {len(extracted_records)} 条扩散数据！")
                    
                    for record in extracted_records:
                        record["Source_File"] = pdf_file
                        
                        # 🛠️ 核心操作：解包 novel_features
                        # 把模型装在字典里的新特征全部释放出来，这样 Pandas 就会自动新建列
                        if "novel_features" in record and record["novel_features"]:
                            for new_key, new_value in record["novel_features"].items():
                                record[new_key] = new_value
                        
                        record.pop("novel_features", None)
                        all_extracted_data.append(record)
            else:
                print("  [!] API 返回的数据格式异常。")
        
        with open(processed_log_file, 'a', encoding='utf-8') as pf:
            pf.write(f"{pdf_file}\n")
            
        processed_count += 1

    # 保存结果到 Excel
    if all_extracted_data:
        all_extracted_data = process_extracted_records(all_extracted_data)
        
        df = pd.DataFrame(all_extracted_data)
        # 整理列顺序：Source_File 第一，核心变量靠前
        cols = df.columns.tolist()
        if "Source_File" in cols:
            cols.insert(0, cols.pop(cols.index("Source_File")))
        df = df[cols]
        
        df.to_excel(excel_filename, index=False)
        print(f"\n💾 数据已更新保存至 Excel: {excel_filename}")
        print("💡 提示：如果模型发现了新特征，打开 Excel 看看最右侧是不是多出了新列！")

if __name__ == "__main__":
    # 在这里设置你要测试的篇数
    batch_process_papers(reference_folder="Reference", excel_filename="Extraction_Results.xlsx", max_process_once=206)