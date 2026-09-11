# CAD 版本与命名

## 建议目录

```text
cad/
  envelope/       硬件与运动包络
  carrier/        固定内骨架
  interface-v1/   标准安装接口
  shells/         可替换外壳
  calibration/    打印公差校准件
  exports/        STEP、STL 和装配图导出
```

## 文件名

使用 `对象_接口版本_迭代号_状态`，例如：

```text
carrier_if-v1_r03_test.step
shell_observer_if-v1_r02_print.stl
clearance_coupon_r01_print.stl
```

每个打印版本都应关联材料、切片参数、打印机、公差测试结果和实验日志。不要用 `final` 作为版本名。

