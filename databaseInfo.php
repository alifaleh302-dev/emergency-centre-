<?php
$database_url = "postgresql://emergencycenterdb_user:rbRGd6GUfvDvhEccTrgJzgSOIGwOj5T3@dpg-d742ar5m5p6s73f0spv0-a.ohio-postgres.render.com/emergencycenterdb";

// 2. تفكيك الرابط واستخراج البيانات منه
$db_parts = parse_url($database_url);

$host = $db_parts["host"];
$port = isset($db_parts["port"]) ? $db_parts["port"] : '5432';
$user = $db_parts["user"];
$password = $db_parts["pass"];
// الدالة ltrim تحذف علامة "/" من بداية اسم قاعدة البيانات الموجودة في الرابط
$dbname = ltrim($db_parts["path"], '/'); 

// 3. إعداد DSN (Data Source Name) ليتوافق مع إضافة PDO


try {
    $dsn = "pgsql:host=$host;port=$port;dbname=$dbname;";
    $pdo = new PDO($dsn, $user, $password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

    // الاستعلام الشامل لجلب الجداول، الأعمدة، أنواع البيانات، المفاتيح، والقيم الافتراضية
    $sql = "
        SELECT 
            table_name, 
            column_name, 
            data_type, 
            character_maximum_length, 
            is_nullable, 
            column_default,
            (
                SELECT 'YES'
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu 
                  ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_name = cols.table_name 
                  AND kcu.column_name = cols.column_name 
                  AND tc.constraint_type = 'PRIMARY KEY'
            ) AS is_primary
        FROM 
            information_schema.columns cols
        WHERE 
            table_schema = 'public'
        ORDER BY 
            table_name, ordinal_position;
    ";

    $stmt = $pdo->query($sql);
    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo "<h2>تفاصيل جداول قاعدة البيانات (PostgreSQL)</h2>";
    echo "<table border='1' cellpadding='10' style='border-collapse: collapse; width: 100%; font-family: sans-serif;'>";
    echo "<tr style='background-color: #f2f2f2;'>
            <th>اسم الجدول</th>
            <th>اسم العمود</th>
            <th>نوع البيانات</th>
            <th>الطول</th>
            <th>يقبل Null؟</th>
            <th>القيمة الافتراضية</th>
            <th>مفتاح أساسي؟</th>
          </tr>";

    foreach ($results as $row) {
        $primaryStyle = $row['is_primary'] === 'YES' ? 'color: red; font-weight: bold;' : '';
        echo "<tr>";
        echo "<td>" . htmlspecialchars($row['table_name']) . "</td>";
        echo "<td style='$primaryStyle'>" . htmlspecialchars($row['column_name']) . "</td>";
        echo "<td>" . htmlspecialchars($row['data_type']) . "</td>";
        echo "<td>" . ($row['character_maximum_length'] ?: '-') . "</td>";
        echo "<td>" . htmlspecialchars($row['is_nullable']) . "</td>";
        echo "<td>" . htmlspecialchars($row['column_default'] ?: 'None') . "</td>";
        echo "<td>" . ($row['is_primary'] ?: 'NO') . "</td>";
        echo "</tr>";
    }
    echo "</table>";

} catch (PDOException $e) {
    die("خطأ في الاتصال: " . $e->getMessage());
}
?>
