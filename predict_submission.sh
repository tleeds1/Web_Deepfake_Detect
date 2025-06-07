TEST_DIR=$1
CSV=$2

python predict_folder.py \
 --test-dir $TEST_DIR \
 --output $CSV \
 --models final_999_DeepFakeClassifier_tf_efficientnet_b7_ns_0_23