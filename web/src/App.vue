<template>
  <router-view />
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
  background: #f5f7fa;
}
#app {
  min-height: 100vh;
}
.page {
  padding: 16px 20px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 10px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
.filter-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.stat-card {
  border-radius: 8px;
  padding: 16px 18px;
  color: #fff;
  min-width: 150px;
}
.stat-card .num {
  font-size: 26px;
  font-weight: 700;
  margin-top: 6px;
}
.bar-wrap {
  background: #ebeef5;
  border-radius: 4px;
  height: 10px;
  overflow: hidden;
}
.bar-inner {
  height: 100%;
  border-radius: 4px;
}
</style>
