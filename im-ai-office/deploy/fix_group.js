
db.group.updateOne({group_id: '1591442033'}, {$set: {group_name: '产品讨论组', introduction: 'AI 办公协同测试群'}});
db.conversation.find({group_id: '1591442033'}).forEach(function(c) {
  db.conversation.updateOne({_id: c._id}, {$set: {show_name: '产品讨论组', group_name: '产品讨论组'}});
});
const g = db.group.findOne({group_id: '1591442033'});
print('FIXED group_name: ' + g.group_name);
